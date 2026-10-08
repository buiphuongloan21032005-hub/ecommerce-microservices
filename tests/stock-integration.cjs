const assert = require("node:assert/strict");
const { MongoMemoryReplSet } = require("mongodb-memory-server-core");
const project = require("node:path").join(__dirname, "..");
const { MongoClient } = require(
  project + "/services/product-service/node_modules/mongodb",
);
const { StockApplication } = require(
  project + "/services/product-service/src/application/stock",
);
(async () => {
  let repl, client;
  try {
    repl = await MongoMemoryReplSet.create({
      binary: { version: "7.0.24" },
      replSet: { count: 1, args: ["--nounixsocket"] },
    });
    client = new MongoClient(repl.getUri());
    await client.connect();
    const db = client.db("stock_test");
    const stock = new StockApplication({ client, db });
    await stock.initialize();
    await db.collection("Product").insertMany([
      { pid: 1, quantity: 5, price: "100.00" },
      { pid: 2, quantity: 1, price: "20.00" },
    ]);
    const a = { reservation_id: "r1", items: [{ pid: 1, qty: 2 }] };
    await stock.reserve(a);
    await stock.reserve(a);
    assert.equal(
      (await db.collection("Product").findOne({ pid: 1 })).quantity,
      3,
    );
    console.log("PASS Mongo reserve replay");
    await assert.rejects(
      stock.reserve({
        reservation_id: "r2",
        items: [
          { pid: 1, qty: 2 },
          { pid: 2, qty: 2 },
        ],
      }),
    );
    assert.equal(
      (await db.collection("Product").findOne({ pid: 1 })).quantity,
      3,
    );
    console.log("PASS Mongo partial failure rollback");
    await stock.release(a);
    await stock.release(a);
    assert.equal(
      (await db.collection("Product").findOne({ pid: 1 })).quantity,
      5,
    );
    console.log("PASS Mongo release replay");
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        stock.reserve({
          reservation_id: "concurrent" + i,
          items: [{ pid: 1, qty: 1 }],
        }),
      ),
    );
    assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 5);
    assert.equal(
      (await db.collection("Product").findOne({ pid: 1 })).quantity,
      0,
    );
    console.log(
      "PASS Mongo 8 concurrent reservations: 5 successes, zero overselling",
    );
    const tombstone = {
      reservation_id: "cancel-first",
      items: [{ pid: 2, qty: 1 }],
    };
    await stock.release(tombstone);
    await assert.rejects(stock.reserve(tombstone));
    assert.equal(
      (await db.collection("Product").findOne({ pid: 2 })).quantity,
      1,
    );
    console.log("PASS Mongo cancellation tombstone");
  } finally {
    if (client) await client.close();
    if (repl) await repl.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
