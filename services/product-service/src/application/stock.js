const { ProductError, validatePid } = require("../domain/product");
function stockInput(input) {
  if (
    typeof input.reservation_id !== "string" ||
    !/^[a-zA-Z0-9:_-]{1,128}$/.test(input.reservation_id)
  )
    throw new ProductError("INVALID_INPUT", "Invalid reservation_id");
  if (
    !Array.isArray(input.items) ||
    !input.items.length ||
    input.items.length > 100
  )
    throw new ProductError("INVALID_INPUT", "Provide 1–100 stock items");
  const seen = new Set();
  const items = input.items
    .map((item) => {
      validatePid(item.pid);
      if (
        seen.has(item.pid) ||
        !Number.isInteger(item.qty) ||
        item.qty < 1 ||
        item.qty > 2147483647
      )
        throw new ProductError(
          "INVALID_INPUT",
          "Invalid quantity or duplicate pid",
        );
      seen.add(item.pid);
      return { pid: item.pid, qty: item.qty };
    })
    .sort((a, b) => a.pid - b.pid);
  return {
    id: input.reservation_id,
    items,
    fingerprint: JSON.stringify(items),
  };
}
class StockApplication {
  constructor({ client, db }) {
    this.client = client;
    this.db = db;
    this.products = db.collection("Product");
    this.reservations = db.collection("StockReservation");
  }
  async initialize() {
    await this.reservations.createIndex(
      { reservation_id: 1 },
      { unique: true },
    );
  }
  async execute(input, release) {
    const { id, items, fingerprint } = stockInput(input);
    const session = this.client.startSession();
    let result;
    try {
      await session.withTransaction(
        async () => {
          const old = await this.reservations.findOne(
            { reservation_id: id },
            { session },
          );
          if (old && old.fingerprint !== fingerprint)
            throw new ProductError(
              "CONFLICT",
              "Reservation id used with different items",
            );
          if (old && (!release || old.status === "RELEASED")) {
            if (!release && old.status === "RELEASED")
              throw new ProductError(
                "CONFLICT",
                "Reservation already released",
              );
            result = old;
            return;
          }
          const reserved = [];
          if (release && old) {
            for (const item of old.items) {
              const updated = await this.products.updateOne(
                { pid: item.pid, quantity: { $lte: 2147483647 - item.qty } },
                { $inc: { quantity: item.qty } },
                { session },
              );
              if (updated.matchedCount !== 1)
                throw new ProductError(
                  "CONFLICT",
                  "Cannot restore stock; product missing or quantity overflow",
                );
            }
          } else if (!release) {
            for (const item of items) {
              const p = await this.products.findOneAndUpdate(
                {
                  pid: item.pid,
                  deleted: { $ne: true },
                  quantity: { $gte: item.qty },
                },
                { $inc: { quantity: -item.qty } },
                {
                  session,
                  returnDocument: "before",
                  includeResultMetadata: false,
                },
              );
              if (!p) {
                const exists = await this.products.findOne(
                  { pid: item.pid, deleted: { $ne: true } },
                  { session },
                );
                throw new ProductError(
                  exists ? "STOCK_CONFLICT" : "NOT_FOUND",
                  exists ? "Insufficient stock" : "Product not found",
                );
              }
              reserved.push({ ...item, unit_price: p.price });
            }
          }
          result = {
            reservation_id: id,
            fingerprint,
            status: release ? "RELEASED" : "RESERVED",
            items: old?.items || reserved,
            createdAt: old?.createdAt || new Date(),
          };
          // A release tombstone also prevents a delayed reserve after cancellation.
          await this.reservations.updateOne(
            { reservation_id: id },
            { $set: result },
            { upsert: true, session },
          );
        },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
      );
      return { reservation_id: id, status: result.status, items: result.items };
    } finally {
      await session.endSession();
    }
  }
  reserve(input) {
    return this.execute(input, false);
  }
  release(input) {
    return this.execute(input, true);
  }
}
module.exports = { StockApplication, stockInput };
