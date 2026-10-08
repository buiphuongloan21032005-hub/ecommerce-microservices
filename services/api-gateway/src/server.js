require("dotenv").config({
  path: require("node:path").join(__dirname, "../.env"),
});
const express = require("express");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("node:crypto");
const { createClient } = require("redis");
const { grpc, client, call, positive } = require("../../../shared/rpc");
if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET required");
const clients = {};
for (const [name, port] of Object.entries({
  auth: 50051,
  customer: 50052,
  product: 50053,
  order: 50054,
  shipment: 50055,
}))
  clients[name] = client(
    name,
    process.env[name.toUpperCase() + "_GRPC_ADDRESS"] || `127.0.0.1:${port}`,
  );
const redis = createClient({
  disableOfflineQueue: true,
  url: process.env.REDIS_URL || "redis://localhost:6379",
  socket: { connectTimeout: 5000 },
});
redis.on("error", (e) => console.error("Redis:", e.message));
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () =>
    console.log(
      JSON.stringify({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - started,
      }),
    ),
  );
  next();
});
app.use(express.json({ limit: "64kb" }));
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const rpc = (name, method, input, timeout) =>
  call(clients[name], method, input, timeout);
const id = (req, name) => {
  const value = req.params[name];
  if (!/^[1-9]\d*$/.test(value))
    throw Object.assign(new Error("Invalid " + name), { status: 400 });
  return positive(Number(value), name);
};
function auth(req, res, next) {
  try {
    const [scheme, token, ...rest] = (req.headers.authorization || "").split(
      " ",
    );
    if (scheme !== "Bearer" || !token || rest.length) throw Error();
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
    const uid = Number(payload.sub);
    if (
      !Number.isInteger(uid) ||
      uid < 1 ||
      uid > 2147483647 ||
      !["normal", "admin", "shipment_staff"].includes(payload.role)
    )
      throw Error();
    req.identity = { requester_uid: uid, requester_role: payload.role };
    req.uid = uid;
    next();
  } catch {
    res.status(401).json({ error: "Missing or invalid token" });
  }
}
const roles =
  (...allowed) =>
  (req, res, next) =>
    allowed.includes(req.identity.requester_role)
      ? next()
      : res.status(403).json({ error: "Forbidden" });
function own(req, res, next) {
  const uid = id(req, "uid");
  if (uid !== req.uid && req.identity.requester_role !== "admin")
    return res.status(403).json({ error: "Forbidden" });
  next();
}
app.get(
  "/api/health",
  wrap(async (req, res) => {
    const checks = {};
    await Promise.all(
      Object.keys(clients).map(async (name) => {
        try {
          checks[name] = (await rpc(name, "Health", {}, 2500)).status;
        } catch {
          checks[name] = "DOWN";
        }
      }),
    );
    try {
      checks.redis = (await redis.ping()) === "PONG" ? "UP" : "DOWN";
    } catch {
      checks.redis = "DOWN";
    }
    const healthy = Object.values(checks).every((v) => v === "UP");
    res
      .status(healthy ? 200 : 503)
      .json({
        status: healthy ? "UP" : "DOWN",
        message: "E-commerce API",
        dependencies: checks,
      });
  }),
);
app.use(
  "/api",
  wrap(async (req, res, next) => {
    const key = `rate:${req.ip}:${Math.floor(Date.now() / 60000)}`;
    const count = await redis.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],61) end; return n",
      { keys: [key], arguments: [] },
    );
    if (count > Number(process.env.RATE_LIMIT_PER_MINUTE || 300)) {
      res.set("Retry-After", "60");
      return res.status(429).json({ error: "Too many requests" });
    }
    next();
  }),
);
app.use("/api/auth", (req, res, next) => {
  if (
    !req.body ||
    Array.isArray(req.body) ||
    typeof req.body.username !== "string" ||
    typeof req.body.password !== "string"
  )
    return res
      .status(400)
      .json({ error: "username and password must be strings" });
  for (const f of ["email", "phone", "fullname"])
    if (Object.hasOwn(req.body, f) && typeof req.body[f] !== "string")
      return res.status(400).json({ error: "Invalid " + f });
  next();
});
app.post(
  "/api/auth/register",
  wrap(async (req, res) =>
    res.status(201).json(await rpc("auth", "Register", req.body)),
  ),
);
app.post(
  "/api/auth/login",
  wrap(async (req, res) => {
    const t = await rpc("auth", "Login", req.body);
    res.json({
      accessToken: t.access_token,
      tokenType: t.token_type,
      expiresIn: t.expires_in,
    });
  }),
);

app.use("/api", auth);
app.use("/api", (req, res, next) => {
  if (
    req.body === null ||
    typeof req.body !== "object" ||
    Array.isArray(req.body)
  )
    return res.status(400).json({ error: "JSON body must be an object" });
  for (const f of ["fullname", "pname", "mname", "status"])
    if (Object.hasOwn(req.body, f) && typeof req.body[f] !== "string")
      return res.status(400).json({ error: "Invalid " + f });
  for (const f of ["quantity", "mid", "score"])
    if (
      Object.hasOwn(req.body, f) &&
      (!Number.isInteger(req.body[f]) ||
        req.body[f] < 0 ||
        req.body[f] > 2147483647)
    )
      return res.status(400).json({ error: "Invalid " + f });
  next();
});
app.get(
  "/api/memberships/:mid",
  wrap(async (req, res) =>
    res.json(await rpc("customer", "GetMembership", { mid: id(req, "mid") })),
  ),
);
app.post(
  "/api/memberships",
  roles("admin"),
  wrap(async (req, res) =>
    res
      .status(201)
      .json(
        await rpc("customer", "CreateMembership", {
          mname: req.body.mname,
          score: req.body.score,
        }),
      ),
  ),
);
app.put(
  "/api/memberships/:mid",
  roles("admin"),
  wrap(async (req, res) => {
    const input = { mid: id(req, "mid") };
    for (const f of ["mname", "score"])
      if (Object.hasOwn(req.body, f)) input[f] = req.body[f];
    res.json(await rpc("customer", "UpdateMembership", input));
  }),
);

app.get(
  "/api/customers/:uid",
  own,
  wrap(async (req, res) =>
    res.json(await rpc("customer", "GetCustomer", { uid: id(req, "uid") })),
  ),
);
app.put(
  "/api/customers/:uid",
  own,
  wrap(async (req, res) => {
    if (
      Object.hasOwn(req.body, "mid") &&
      req.identity.requester_role !== "admin"
    )
      return res
        .status(403)
        .json({ error: "Only admin can change membership" });
    const input = { uid: id(req, "uid") };
    for (const field of ["fullname", "mid"])
      if (Object.hasOwn(req.body, field)) input[field] = req.body[field];
    const c = await rpc("customer", "UpdateCustomer", input);
    res.json({ message: "Customer updated successfully", ...c });
  }),
);
async function cached(key, load) {
  let revision = "0";
  try {
    revision = (await redis.get("product:revision")) || "0";
    const stored = await redis.get(`${key}:${revision}`);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.warn("Cache read:", e.message);
  }
  const value = await load();
  try {
    await redis.set(`${key}:${revision}`, JSON.stringify(value), { EX: 5 });
  } catch (e) {
    console.warn("Cache write:", e.message);
  }
  return value;
}
async function invalidate() {
  try {
    await redis.incr("product:revision");
  } catch (e) {
    console.warn("Cache invalidate:", e.message);
  }
}
app.get(
  "/api/products",
  wrap(async (req, res) =>
    res.json(
      await cached("products", () => rpc("product", "ListProducts", {})),
    ),
  ),
);
app.get(
  "/api/products/:pid",
  wrap(async (req, res) => {
    const pid = id(req, "pid");
    res.json(
      await cached(`product:${pid}`, () =>
        rpc("product", "GetProduct", { pid }),
      ),
    );
  }),
);
app.post(
  "/api/products",
  roles("admin"),
  wrap(async (req, res) => {
    const p = await rpc("product", "CreateProduct", {
      pname: req.body.pname,
      price: String(req.body.price ?? ""),
      quantity: req.body.quantity,
    });
    await invalidate();
    res.status(201).json(p);
  }),
);
app.put(
  "/api/products/:pid",
  roles("admin"),
  wrap(async (req, res) => {
    const input = { pid: id(req, "pid") };
    for (const field of ["pname", "price", "quantity"])
      if (Object.hasOwn(req.body, field))
        input[field] =
          field === "price" ? String(req.body[field]) : req.body[field];
    const p = await rpc("product", "UpdateProduct", input);
    await invalidate();
    res.json({ message: "Product updated successfully", ...p });
  }),
);
app.delete(
  "/api/products/:pid",
  roles("admin"),
  wrap(async (req, res) => {
    const p = await rpc("product", "DeleteProduct", { pid: id(req, "pid") });
    await invalidate();
    res.json(p);
  }),
);
async function shipment(oid, identity) {
  try {
    return await rpc(
      "shipment",
      "GetShipmentByOrder",
      { oid, ...identity },
      2000,
    );
  } catch (e) {
    if (
      [
        grpc.status.NOT_FOUND,
        grpc.status.UNAVAILABLE,
        grpc.status.DEADLINE_EXCEEDED,
      ].includes(e.code)
    )
      return null;
    throw e;
  }
}
app.post(
  "/api/orders",
  wrap(async (req, res) => {
    if (
      !Array.isArray(req.body.items) ||
      !req.body.items.length ||
      req.body.items.length > 100 ||
      req.body.items.some(
        (i) =>
          !i ||
          !Number.isInteger(i.pid) ||
          i.pid < 1 ||
          i.pid > 2147483647 ||
          !Number.isInteger(i.qty) ||
          i.qty < 1 ||
          i.qty > 2147483647,
      )
    )
      return res.status(400).json({ error: "Invalid order items" });
    const request_id = req.headers["idempotency-key"] || randomUUID();
    res.set("Idempotency-Key", request_id);
    const o = await rpc(
      "order",
      "CreateOrder",
      { uid: req.uid, items: req.body.items, request_id },
      35000,
    );
    await invalidate();
    res
      .status(201)
      .json({ ...o, shipment: await shipment(o.oid, req.identity) });
  }),
);
app.get(
  "/api/orders",
  wrap(async (req, res) =>
    res.json(await rpc("order", "ListOrders", { uid: req.uid })),
  ),
);
app.get(
  "/api/orders/:oid",
  wrap(async (req, res) => {
    const o = await rpc("order", "GetOrder", {
      oid: id(req, "oid"),
      ...req.identity,
    });
    res.json({ ...o, shipment: await shipment(o.oid, req.identity) });
  }),
);
app.get(
  "/api/shipments/by-order/:oid",
  wrap(async (req, res) =>
    res.json(
      await rpc("shipment", "GetShipmentByOrder", {
        oid: id(req, "oid"),
        ...req.identity,
      }),
    ),
  ),
);
app.get(
  "/api/shipments/:shipid",
  wrap(async (req, res) =>
    res.json(
      await rpc("shipment", "GetShipment", {
        shipid: id(req, "shipid"),
        ...req.identity,
      }),
    ),
  ),
);
app.patch(
  "/api/shipments/:shipid/status",
  roles("admin", "shipment_staff"),
  wrap(async (req, res) =>
    res.json(
      await rpc("shipment", "UpdateShipmentStatus", {
        shipid: id(req, "shipid"),
        status: req.body.status,
        ...req.identity,
      }),
    ),
  ),
);
app.use((req, res) => res.status(404).json({ error: "Route not found" }));
app.use((e, req, res, next) => {
  const codes = {
    [grpc.status.INVALID_ARGUMENT]: 400,
    [grpc.status.UNAUTHENTICATED]: 401,
    [grpc.status.PERMISSION_DENIED]: 403,
    [grpc.status.NOT_FOUND]: 404,
    [grpc.status.ALREADY_EXISTS]: 409,
    [grpc.status.FAILED_PRECONDITION]: 409,
    [grpc.status.ABORTED]: 409,
    [grpc.status.UNAVAILABLE]: 503,
    [grpc.status.DEADLINE_EXCEEDED]: 504,
  };
  const status =
    e.type === "entity.parse.failed" ? 400 : e.status || codes[e.code] || 500;
  if (status >= 500) console.error(e.message);
  res
    .status(status)
    .json({
      error: status === 500 ? "Internal server error" : e.details || e.message,
    });
});
let server;
async function main() {
  await redis.connect();
  server = app.listen(process.env.GATEWAY_PORT || 3002, "0.0.0.0", () =>
    console.log("Gateway ready"),
  );
}
async function shutdown() {
  if (server) await new Promise((r) => server.close(r));
  Object.values(clients).forEach((c) => c.close());
  if (redis.isOpen) await redis.quit();
}
process.on("SIGTERM", () => shutdown().catch(console.error));
process.on("SIGINT", () => shutdown().catch(console.error));
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
