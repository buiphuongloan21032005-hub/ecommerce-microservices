const test = require("node:test"),
  assert = require("node:assert/strict");
const { grpc, service, client, call, handle } = require("../shared/rpc");
const {
  normalize,
  totals,
} = require("../services/order-service/src/domain/order");
const {
  validateEvent,
  access,
  transition,
} = require("../services/shipment-service/src/domain/shipment");
const {
  StockApplication,
  stockInput,
} = require("../services/product-service/src/application/stock");
const {
  validatePrice,
  validateQuantity,
} = require("../services/product-service/src/domain/product");
const createSecurity = require("../services/auth-service/src/infrastructure/security");
const {
  OrderApplication,
} = require("../services/order-service/src/application/order-application");
const valid = { uid: 1, request_id: "req-1", items: [{ pid: 1, qty: 2 }] };
test("Order rejects empty items", () =>
  assert.throws(() => normalize({ ...valid, items: [] })));
test("Order rejects fractional qty", () =>
  assert.throws(() => normalize({ ...valid, items: [{ pid: 1, qty: 1.5 }] })));
test("Order rejects duplicate pid", () =>
  assert.throws(() =>
    normalize({
      ...valid,
      items: [
        { pid: 1, qty: 1 },
        { pid: 1, qty: 2 },
      ],
    }),
  ));
test("Order rejects missing request id", () =>
  assert.throws(() => normalize({ ...valid, request_id: "" })));
test("Order sorts items for stable idempotency", () =>
  assert.deepEqual(
    normalize({
      ...valid,
      items: [
        { pid: 2, qty: 1 },
        { pid: 1, qty: 2 },
      ],
    }),
    [
      { pid: 1, qty: 2 },
      { pid: 2, qty: 1 },
    ],
  ));
test("Money arithmetic avoids floating point error", () =>
  assert.deepEqual(totals([{ unit_price: "0.10", qty: 3 }], 0), {
    subtotal: "0.30",
    discount: "0.00",
    total: "0.30",
  }));
test("Default score 10 discounts 10 currency units", () =>
  assert.equal(totals([{ unit_price: "100.00", qty: 2 }], 10).total, "190.00"));
test("Discount cannot exceed subtotal", () =>
  assert.equal(totals([{ unit_price: "5.00", qty: 1 }], 10).total, "0.00"));
test("Discount factor is configurable", () =>
  assert.equal(
    totals([{ unit_price: "100.00", qty: 1 }], 10, "2").discount,
    "20.00",
  ));
test("Negative score rejected", () =>
  assert.throws(() => totals([{ unit_price: "10", qty: 1 }], -1)));
test("Product rejects negative quantity", () =>
  assert.throws(() => validateQuantity(-1)));
test("Product rejects negative price", () =>
  assert.throws(() => validatePrice("-1")));
test("Product rejects 3 decimal price", () =>
  assert.throws(() => validatePrice("1.234")));
test("Stock rejects repeated product", () =>
  assert.throws(() =>
    stockInput({
      reservation_id: "r",
      items: [
        { pid: 1, qty: 1 },
        { pid: 1, qty: 1 },
      ],
    }),
  ));
test("Stock rejects missing reservation", () =>
  assert.throws(() => stockInput({ items: [{ pid: 1, qty: 1 }] })));
test("Shipment rejects missing oid", () =>
  assert.throws(() =>
    validateEvent({ eventId: "e", type: "OrderCreated", version: 1, uid: 1 }),
  ));
test("Shipment validates event envelope", () =>
  assert.equal(
    validateEvent({
      eventId: "e",
      type: "OrderCreated",
      version: 1,
      uid: 1,
      oid: 2,
    }).oid,
    2,
  ));
test("Shipment permits SHIPPING then DELIVERED", () => {
  assert.equal(transition("PENDING", "SHIPPING"), "SHIPPING");
  assert.equal(transition("SHIPPING", "DELIVERED"), "DELIVERED");
});
test("Shipment blocks terminal rollback", () =>
  assert.throws(() => transition("DELIVERED", "PENDING")));
test("Shipment rejects unknown status", () =>
  assert.throws(() => transition("PENDING", "UNKNOWN")));
test("Shipment permits retry same status", () =>
  assert.equal(transition("SHIPPING", "SHIPPING"), "SHIPPING"));
test("Shipment denies another customer", () =>
  assert.throws(() =>
    access({ uid: 1 }, { requester_uid: 2, requester_role: "normal" }),
  ));
test("Shipment denies customer status edits", () =>
  assert.throws(() =>
    access({ uid: 1 }, { requester_uid: 1, requester_role: "normal" }, true),
  ));
test("Shipment permits staff update", () =>
  assert.doesNotThrow(() =>
    access(
      { uid: 1 },
      { requester_uid: 2, requester_role: "shipment_staff" },
      true,
    ),
  ));
test("Password bcrypt and JWT signature/role", async () => {
  const s = createSecurity({ secret: "test-secret-not-for-deploy" });
  const hash = await s.hashPassword("demoPass123");
  assert.ok(hash.startsWith("$2"));
  assert.ok(await s.comparePassword("demoPass123", hash));
  assert.equal(await s.comparePassword("wrong", hash), false);
  const t = s.createToken({ uid: 1, role: { rolename: "normal" } });
  const payload = require("jsonwebtoken").verify(
    t.access_token,
    "test-secret-not-for-deploy",
    { algorithms: ["HS256"] },
  );
  assert.equal(payload.sub, "1");
  assert.equal(payload.role, "normal");
  assert.ok(t.expires_in > 0);
});
// In-memory transactional adapter exercises stock application branches, not Mongo isolation.
function fixture() {
  let products = new Map([
      [1, { pid: 1, quantity: 5, price: "100.00" }],
      [2, { pid: 2, quantity: 1, price: "20.00" }],
    ]),
    records = new Map();
  let ended = false;
  const match = (p, f) =>
    p &&
    (!f.quantity?.$gte || p.quantity >= f.quantity.$gte) &&
    (!f.quantity?.$lte || p.quantity <= f.quantity.$lte);
  const db = {
    collection: (n) =>
      n === "Product"
        ? {
            findOne: async (f) => products.get(f.pid),
            findOneAndUpdate: async (f, u) => {
              const p = products.get(f.pid);
              if (!match(p, f)) return null;
              const old = { ...p };
              p.quantity += u.$inc.quantity;
              return old;
            },
            updateOne: async (f, u) => {
              const p = products.get(f.pid);
              if (!match(p, f)) return { matchedCount: 0 };
              p.quantity += u.$inc.quantity;
              return { matchedCount: 1 };
            },
          }
        : {
            createIndex: async () => {},
            findOne: async (f) => records.get(f.reservation_id),
            updateOne: async (f, u) => records.set(f.reservation_id, u.$set),
          },
  };
  const client = {
    startSession: () => ({
      withTransaction: async (fn) => {
        const ps = structuredClone(products),
          rs = structuredClone(records);
        try {
          await fn();
        } catch (e) {
          products = ps;
          records = rs;
          throw e;
        }
      },
      endSession: async () => {
        ended = true;
      },
    }),
  };
  return {
    stock: new StockApplication({ client, db }),
    quantity: (id) => products.get(id).quantity,
    ended: () => ended,
  };
}
test("Repeated reserve deducts once and keeps captured price", async () => {
  const f = fixture(),
    input = { reservation_id: "r", items: [{ pid: 1, qty: 2 }] };
  const first = await f.stock.reserve(input);
  assert.deepEqual(await f.stock.reserve(input), first);
  assert.equal(f.quantity(1), 3);
  assert.equal(first.items[0].unit_price, "100.00");
  assert.ok(f.ended());
});
test("Partial reserve failure rolls back all deductions", async () => {
  const f = fixture();
  await assert.rejects(
    f.stock.reserve({
      reservation_id: "r",
      items: [
        { pid: 1, qty: 2 },
        { pid: 2, qty: 2 },
      ],
    }),
  );
  assert.equal(f.quantity(1), 5);
  assert.equal(f.quantity(2), 1);
});
test("Release returns quantities exactly once", async () => {
  const f = fixture(),
    i = { reservation_id: "r", items: [{ pid: 1, qty: 2 }] };
  await f.stock.reserve(i);
  await f.stock.release(i);
  await f.stock.release(i);
  assert.equal(f.quantity(1), 5);
});
test("Release before reserve cancels delayed reserve", async () => {
  const f = fixture(),
    i = { reservation_id: "r", items: [{ pid: 1, qty: 2 }] };
  await f.stock.release(i);
  await assert.rejects(f.stock.reserve(i));
  assert.equal(f.quantity(1), 5);
});
test("Reservation cannot be reused with different payload", async () => {
  const f = fixture();
  await f.stock.reserve({ reservation_id: "r", items: [{ pid: 1, qty: 2 }] });
  await assert.rejects(
    f.stock.reserve({ reservation_id: "r", items: [{ pid: 1, qty: 3 }] }),
  );
  assert.equal(f.quantity(1), 3);
});
function orderFixture() {
  const jobs = new Map(),
    orders = new Map(),
    events = new Map();
  let oid = 0,
    reserves = 0;
  const tx = {
    orderRequest: {
      create: async ({ data }) => {
        if (jobs.has(data.key)) throw Object.assign(Error(), { code: "P2002" });
        const j = { state: "PENDING", ...data };
        jobs.set(j.key, j);
        return j;
      },
      findUnique: async ({ where }) => jobs.get(where.key),
      update: async ({ where, data }) =>
        Object.assign(jobs.get(where.key), data),
    },
    order: {
      findUnique: async ({ where }) => orders.get(where.requestKey),
      create: async ({ data }) => {
        const o = {
          oid: ++oid,
          ...data,
          createdAt: new Date(),
          details: data.details.create,
        };
        orders.set(data.requestKey, o);
        return o;
      },
    },
    outbox: { create: async ({ data }) => events.set(data.id, data) },
    $queryRaw: async () => [],
  };
  const prisma = { ...tx, $transaction: async (fn) => fn(tx) };
  const stub = (method) => (req, opts, cb) => method(req, cb);
  const customer = {
    GetCustomer: stub((req, cb) => cb(null, { membership: { score: 10 } })),
  };
  const product = {
    ReserveStock: stub((req, cb) => {
      reserves++;
      cb(null, {
        items: req.items.map((i) => ({ ...i, unit_price: "100.00" })),
      });
    }),
    ReleaseStock: stub((req, cb) => cb(null, {})),
  };
  return {
    app: new OrderApplication({ prisma, customer, product }),
    orders,
    events,
    reserves: () => reserves,
    product,
    jobs,
  };
}
test("Order retry uses same oid, one reservation and one outbox", async () => {
  const f = orderFixture();
  const o = await f.app.create(valid);
  assert.equal((await f.app.create(valid)).oid, o.oid);
  assert.equal(f.reserves(), 1);
  assert.equal(f.events.size, 1);
  assert.equal(o.total, "190.00");
});
test("Order idempotency key rejects changed items", async () => {
  const f = orderFixture();
  await f.app.create(valid);
  await assert.rejects(
    f.app.create({ ...valid, items: [{ pid: 1, qty: 3 }] }),
    (e) => e.code === grpc.status.ALREADY_EXISTS,
  );
});
test("Order permanent stock failure persists FAILED, no order/outbox", async () => {
  const f = orderFixture();
  f.product.ReserveStock = (req, opts, cb) =>
    cb({
      code: grpc.status.FAILED_PRECONDITION,
      details: "Insufficient stock",
    });
  await assert.rejects(
    f.app.create(valid),
    (e) => e.code === grpc.status.FAILED_PRECONDITION,
  );
  assert.equal(f.orders.size, 0);
  assert.equal(f.events.size, 0);
  assert.equal(f.jobs.get("1:req-1").state, "FAILED");
});
test("Real gRPC wire preserves optional field absence and status code", async () => {
  const server = new grpc.Server();
  server.addService(service("customer").service, {
    UpdateCustomer: handle(async (req) => {
      assert.equal(Object.hasOwn(req, "mid"), false);
      return { uid: req.uid, fullname: req.fullname, mid: 1 };
    }),
    Health: handle(async () => {
      throw Object.assign(Error("offline"), { code: grpc.status.UNAVAILABLE });
    }),
  });
  const port = await new Promise((res, rej) =>
    server.bindAsync(
      "127.0.0.1:0",
      grpc.ServerCredentials.createInsecure(),
      (e, p) => (e ? rej(e) : res(p)),
    ),
  );
  const c = client("customer", `127.0.0.1:${port}`);
  try {
    assert.equal(
      (await call(c, "UpdateCustomer", { uid: 1, fullname: "A" })).mid,
      1,
    );
    await assert.rejects(
      call(c, "Health", {}),
      (e) => e.code === grpc.status.UNAVAILABLE,
    );
  } finally {
    c.close();
    await new Promise((r) => server.tryShutdown(r));
  }
});
