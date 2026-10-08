const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const base =
  process.env.API_BASE_URL ||
  `http://localhost:${process.env.GATEWAY_PORT || 3002}`;
let user, token, admin, product, order, shipment;
const results = [];
const username = "e2e_" + randomUUID().slice(0, 12),
  password = "TestPass123!";
async function req(method, url, body, bearer = token, headers = {}) {
  const r = await fetch(base + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(45000),
  });
  return { status: r.status, body: await r.json() };
}
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, result: "PASS" });
    console.log("PASS:", name);
  } catch (e) {
    results.push({ name, result: "FAIL", error: e.message });
    console.error("FAIL:", name, e.message);
    throw e;
  }
}
async function waitShipment() {
  for (let i = 0; i < 40; i++) {
    const r = await req("GET", `/api/shipments/by-order/${order.oid}`);
    if (r.status === 200) return r.body;
    if (r.status !== 404) throw Error(JSON.stringify(r));
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("Shipment not created within 20 seconds");
}
async function main() {
  assert.equal(
    (await req("GET", "/api/health", undefined, null)).status,
    200,
    "Start Docker Compose first",
  );
  const login = await req(
    "POST",
    "/api/auth/login",
    {
      username: process.env.ADMIN_USERNAME || "demo_admin",
      password: process.env.ADMIN_PASSWORD || "DemoAdmin123!",
    },
    null,
  );
  assert.equal(login.status, 200, "Demo admin login");
  admin = login.body.accessToken;
  await check("TC-IAM-01 Register + customer provisioning", async () => {
    const r = await req(
      "POST",
      "/api/auth/register",
      { username, password, fullname: "Khách E2E" },
      null,
    );
    assert.equal(r.status, 201);
    user = r.body.uid;
  });
  await check("TC-IAM-02 Duplicate username", async () =>
    assert.equal(
      (await req("POST", "/api/auth/register", { username, password }, null))
        .status,
      409,
    ),
  );
  await check("TC-IAM-03 Missing password", async () =>
    assert.equal(
      (
        await req(
          "POST",
          "/api/auth/register",
          { username: username + "_bad" },
          null,
        )
      ).status,
      400,
    ),
  );
  await check("TC-IAM-04 Login JWT", async () => {
    const r = await req(
      "POST",
      "/api/auth/login",
      { username, password },
      null,
    );
    assert.equal(r.status, 200);
    token = r.body.accessToken;
    assert.equal(r.body.tokenType, "Bearer");
    assert.ok(r.body.expiresIn > 0);
  });
  await check("TC-IAM-05 Wrong password", async () =>
    assert.equal(
      (
        await req(
          "POST",
          "/api/auth/login",
          { username, password: "wrong" },
          null,
        )
      ).status,
      401,
    ),
  );
  await check("TC-CUS-01 Existing customer", async () =>
    assert.equal((await req("GET", `/api/customers/${user}`)).body.uid, user),
  );
  await check("TC-CUS-02 Missing customer", async () =>
    assert.equal(
      (await req("GET", "/api/customers/2147483647", undefined, admin)).status,
      404,
    ),
  );
  await check("TC-CUS-03 Update own fullname", async () => {
    const r = await req("PUT", `/api/customers/${user}`, {
      fullname: "Khách cập nhật",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.fullname, "Khách cập nhật");
  });
  await check("TC-CUS-04 Default normal score 10", async () => {
    const r = await req("GET", `/api/customers/${user}`);
    assert.equal(r.body.membership.mname, "normal");
    assert.equal(r.body.membership.score, 10);
  });
  await check("TC-CUS-05 Missing JWT", async () =>
    assert.equal(
      (await req("GET", `/api/customers/${user}`, undefined, null)).status,
      401,
    ),
  );
  await check("TC-PRO-01 List products", async () =>
    assert.ok(Array.isArray((await req("GET", "/api/products")).body.items)),
  );
  await check("TC-PRO-04 Admin create product", async () => {
    const r = await req(
      "POST",
      "/api/products",
      { pname: "E2E " + username, price: "100.00", quantity: 20 },
      admin,
    );
    assert.equal(r.status, 201);
    product = r.body;
  });
  await check("TC-PRO-02 Get product", async () =>
    assert.equal(
      (await req("GET", `/api/products/${product.pid}`)).body.pid,
      product.pid,
    ),
  );
  await check("TC-PRO-03 Missing product", async () =>
    assert.equal((await req("GET", "/api/products/2147483647")).status, 404),
  );
  await check("TC-PRO-05 Admin update quantity", async () => {
    const r = await req(
      "PUT",
      `/api/products/${product.pid}`,
      { quantity: 30 },
      admin,
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.quantity, 30);
  });
  await check("TC-ORD-01 Create order", async () => {
    const r = await req(
      "POST",
      "/api/orders",
      { items: [{ pid: product.pid, qty: 2 }] },
      token,
      { "Idempotency-Key": username },
    );
    assert.equal(r.status, 201);
    order = r.body;
  });
  await check("EXTRA Read order details", async () => {
    const r = await req("GET", `/api/orders/${order.oid}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.items[0].qty, 2);
    assert.equal(Number(r.body.items[0].unit_price), 100);
  });
  // Prisma decimal serialization may omit trailing zeros; compare numeric values.
  await check("TC-ORD-02 Missing JWT", async () =>
    assert.equal(
      (
        await req(
          "POST",
          "/api/orders",
          { items: [{ pid: product.pid, qty: 1 }] },
          null,
        )
      ).status,
      401,
    ),
  );
  await check("TC-ORD-03 Insufficient stock", async () =>
    assert.equal(
      (
        await req("POST", "/api/orders", {
          items: [{ pid: product.pid, qty: 9999 }],
        })
      ).status,
      409,
    ),
  );
  await check("TC-ORD-04 Discount from score", async () => {
    assert.equal(
      Number(order.discount),
      Math.min(200, 10 * Number(process.env.DISCOUNT_PER_POINT || 1)),
    );
    assert.equal(Number(order.total), 200 - Number(order.discount));
  });
  await check("TC-ORD-05 Outbox published OrderCreated", async () => {
    shipment = await waitShipment();
    const { execFileSync } = require("node:child_process");
    const out = execFileSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "order-db",
        "psql",
        "-U",
        process.env.POSTGRES_USER || "ecommerce",
        "-d",
        process.env.ORDER_DB_NAME || "order_db",
        "-At",
        "-c",
        `SELECT count(*) FROM "Outbox" WHERE oid=${order.oid} AND "publishedAt" IS NOT NULL AND payload->>'type'='OrderCreated';`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(Number(out.trim()), 1);
  });
  await check("TC-SHP-01 Kafka creates shipment", async () => {
    shipment = await waitShipment();
    assert.equal(shipment.status, "PENDING");
    assert.equal(shipment.oid, order.oid);
  });
  await check("TC-SHP-02 Missing oid event rejected", async () => {
    const { execFileSync } = require("node:child_process");
    const bad = JSON.stringify({
      eventId: randomUUID(),
      type: "OrderCreated",
      version: 1,
      uid: user,
    });
    execFileSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "kafka",
        "/opt/kafka/bin/kafka-console-producer.sh",
        "--bootstrap-server",
        "kafka:9092",
        "--topic",
        process.env.KAFKA_ORDER_TOPIC || "order-created",
      ],
      { input: bad + "\n", timeout: 20000 },
    );
    let rejected = false;
    for (let i = 0; i < 20; i++) {
      const out = execFileSync(
        "docker",
        [
          "compose",
          "exec",
          "-T",
          "shipment-db",
          "mongosh",
          "shipment_db",
          "--quiet",
          "--eval",
          `print(db.RejectedEvent.countDocuments({body:${JSON.stringify(bad)}}))`,
        ],
        { encoding: "utf8" },
      );
      if (Number(out.trim()) > 0) {
        rejected = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(rejected, "RejectedEvent persisted");
  });
  await check("TC-SHP-03 Admin updates SHIPPING", async () => {
    const r = await req(
      "PATCH",
      `/api/shipments/${shipment.shipid}/status`,
      { status: "SHIPPING" },
      admin,
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "SHIPPING");
  });
  await check("TC-SHP-04 Missing shipment", async () =>
    assert.equal(
      (
        await req(
          "PATCH",
          "/api/shipments/2147483647/status",
          { status: "SHIPPING" },
          admin,
        )
      ).status,
      404,
    ),
  );
  await check("TC-SHP-05 Duplicate Kafka event deduplicated", async () => {
    const { execFileSync } = require("node:child_process");
    const saved = execFileSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "order-db",
        "psql",
        "-U",
        process.env.POSTGRES_USER || "ecommerce",
        "-d",
        process.env.ORDER_DB_NAME || "order_db",
        "-At",
        "-c",
        `SELECT payload::text FROM "Outbox" WHERE oid=${order.oid};`,
      ],
      { encoding: "utf8" },
    );
    const event = JSON.parse(saved.trim());
    execFileSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "kafka",
        "/opt/kafka/bin/kafka-console-producer.sh",
        "--bootstrap-server",
        "kafka:9092",
        "--topic",
        process.env.KAFKA_ORDER_TOPIC || "order-created",
      ],
      {
        input: JSON.stringify(event) + "\n" + JSON.stringify(event) + "\n",
        timeout: 20000,
      },
    );
    let caughtUp = false;
    for (let i = 0; i < 20; i++) {
      const state = execFileSync(
        "docker",
        [
          "compose",
          "exec",
          "-T",
          "kafka",
          "/opt/kafka/bin/kafka-consumer-groups.sh",
          "--bootstrap-server",
          "kafka:9092",
          "--describe",
          "--group",
          "shipment-service-v1",
        ],
        { encoding: "utf8", timeout: 20000 },
      );
      const rows = state
        .split("\n")
        .map((line) => line.trim().split(/\s+/))
        .filter(
          (parts) =>
            parts[0] === "shipment-service-v1" &&
            parts[1] === (process.env.KAFKA_ORDER_TOPIC || "order-created"),
        );
      if (rows.length && rows.every((parts) => parts[5] === "0")) {
        caughtUp = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(caughtUp, "Kafka consumer did not catch up");
    const out = execFileSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "shipment-db",
        "mongosh",
        "shipment_db",
        "--quiet",
        "--eval",
        `print(db.Shipment.countDocuments({oid:${order.oid}}))`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(Number(out.trim()), 1);
    assert.equal((await waitShipment()).shipid, shipment.shipid);
  });
  await check("EXTRA Idempotent order does not deduct twice", async () => {
    const r = await req(
      "POST",
      "/api/orders",
      { items: [{ pid: product.pid, qty: 2 }] },
      token,
      { "Idempotency-Key": username },
    );
    assert.equal(r.status, 201);
    assert.equal(r.body.oid, order.oid);
    assert.equal(
      (await req("GET", `/api/products/${product.pid}`)).body.quantity,
      28,
    );
  });
  await check("EXTRA Customer cannot create product", async () =>
    assert.equal(
      (
        await req("POST", "/api/products", {
          pname: "bad",
          price: 1,
          quantity: 1,
        })
      ).status,
      403,
    ),
  );
  await check("EXTRA Customer cannot change membership", async () =>
    assert.equal(
      (await req("PUT", `/api/customers/${user}`, { mid: 1 })).status,
      403,
    ),
  );
  await check("EXTRA Cross-customer access denied", async () =>
    assert.equal((await req("GET", "/api/customers/2147483647")).status, 403),
  );
  await check("EXTRA Product delete", async () =>
    assert.equal(
      (await req("DELETE", `/api/products/${product.pid}`, undefined, admin))
        .status,
      200,
    ),
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync(
      "test-results/e2e.json",
      JSON.stringify({ at: new Date().toISOString(), results }, null, 2),
    );
    console.log(
      `${results.filter((r) => r.result === "PASS").length}/${results.length} executed cases passed`,
    );
  });
