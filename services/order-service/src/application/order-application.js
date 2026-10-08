const { createHash, randomUUID } = require("node:crypto");
const { grpc, fail, call, positive } = require("../../../../shared/rpc");
const { normalize, totals, response } = require("../domain/order");
class OrderApplication {
  constructor({ prisma, product, customer }) {
    Object.assign(this, { prisma, product, customer });
    this.active = new Map();
  }
  async create(input) {
    const items = normalize(input);
    const key = `${input.uid}:${input.request_id}`;
    const fingerprint = JSON.stringify(items);
    let job;
    try {
      job = await this.prisma.orderRequest.create({
        data: { key, uid: input.uid, items, fingerprint },
      });
    } catch (e) {
      if (e.code !== "P2002") throw e;
      job = await this.prisma.orderRequest.findUnique({ where: { key } });
    }
    if (job.fingerprint !== fingerprint)
      throw fail(
        grpc.status.ALREADY_EXISTS,
        "Idempotency key reused with different items",
      );
    return this.process(job);
  }
  process(job) {
    if (this.active.has(job.key)) return this.active.get(job.key);
    const task = this.run(job).finally(() => this.active.delete(job.key));
    this.active.set(job.key, task);
    return task;
  }
  async run(job) {
    // Lock the durable request row so retries and multiple workers cannot reserve twice.
    return this.prisma
      .$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT key FROM "OrderRequest" WHERE key = ${job.key} FOR UPDATE`;
          job = await tx.orderRequest.findUnique({ where: { key: job.key } });
          if (job.state === "FAILED")
            return {
              failure: { code: job.errorCode, details: job.errorMessage },
            };
          const existing = await tx.order.findUnique({
            where: { requestKey: job.key },
            include: { details: true },
          });
          if (existing) return response(existing);
          let stock, amount;
          const reservation_id =
            "ord_" + createHash("sha256").update(job.key).digest("hex");
          try {
            const customer = await call(this.customer, "GetCustomer", {
              uid: job.uid,
            });
            stock = await call(this.product, "ReserveStock", {
              reservation_id,
              items: job.items,
            });
            amount = totals(
              stock.items,
              customer.membership?.score,
              process.env.DISCOUNT_PER_POINT || "1",
            );
          } catch (e) {
            if (
              [
                grpc.status.INVALID_ARGUMENT,
                grpc.status.NOT_FOUND,
                grpc.status.ALREADY_EXISTS,
                grpc.status.FAILED_PRECONDITION,
              ].includes(e.code)
            ) {
              // Release also cancels a delayed reservation. If release fails, leave PENDING for retry.
              await call(this.product, "ReleaseStock", {
                reservation_id,
                items: job.items,
              });
              await tx.orderRequest.update({
                where: { key: job.key },
                data: {
                  state: "FAILED",
                  errorCode: e.code,
                  errorMessage: e.details || e.message,
                },
              });
              return {
                failure: { code: e.code, details: e.details || e.message },
              };
            }
            throw e;
          }
          const order = await tx.order.create({
            data: {
              uid: job.uid,
              requestKey: job.key,
              ...amount,
              details: {
                create: stock.items.map((i) => ({
                  pid: i.pid,
                  qty: i.qty,
                  unitPrice: i.unit_price,
                })),
              },
            },
            include: { details: true },
          });
          const event = {
            eventId: randomUUID(),
            type: "OrderCreated",
            version: 1,
            oid: order.oid,
            uid: order.uid,
            createdAt: order.createdAt.toISOString(),
            items: stock.items,
          };
          await tx.outbox.create({
            data: { id: event.eventId, oid: order.oid, payload: event },
          });
          await tx.orderRequest.update({
            where: { key: job.key },
            data: { state: "SUCCEEDED" },
          });
          return response(order);
        },
        { timeout: 30000, maxWait: 10000 },
      )
      .then((result) => {
        if (result.failure)
          throw fail(result.failure.code, result.failure.details);
        return result;
      });
  }
  async retry() {
    const jobs = await this.prisma.orderRequest.findMany({
      where: { state: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    for (const job of jobs) {
      try {
        await this.process(job);
      } catch (e) {
        console.warn("Order retry:", job.key, e.details || e.message);
      }
    }
  }
  async list(input) {
    positive(input.uid, "uid");
    const items = await this.prisma.order.findMany({
      where: { uid: input.uid },
      include: { details: true },
      orderBy: { oid: "desc" },
    });
    return { items: items.map(response) };
  }
  async get(input) {
    positive(input.oid, "oid");
    const order = await this.prisma.order.findUnique({
      where: { oid: input.oid },
      include: { details: true },
    });
    if (!order) throw fail(grpc.status.NOT_FOUND, "Order not found");
    if (order.uid !== input.requester_uid && input.requester_role !== "admin")
      throw fail(grpc.status.PERMISSION_DENIED, "Forbidden");
    return response(order);
  }
}
module.exports = { OrderApplication };
