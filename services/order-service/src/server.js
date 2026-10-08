require("dotenv").config({
  path: require("node:path").join(__dirname, "../.env"),
});
const prisma = require("./infrastructure/prisma");
const { Kafka, logLevel } = require("kafkajs");
const {
  grpc,
  service,
  client,
  handle,
  listen,
  fail,
} = require("../../../shared/rpc");
const { OrderApplication } = require("./application/order-application");
const product = client(
  "product",
  process.env.PRODUCT_GRPC_ADDRESS || "127.0.0.1:50053",
);
const customer = client(
  "customer",
  process.env.CUSTOMER_GRPC_ADDRESS || "127.0.0.1:50052",
);
const producer = new Kafka({
  clientId: "order-service",
  brokers: (process.env.KAFKA_BROKERS || "localhost:19092").split(","),
  logLevel: logLevel.WARN,
}).producer({
  allowAutoTopicCreation: false,
  idempotent: true,
  maxInFlightRequests: 1,
});
const healthAdmin = new Kafka({
  clientId: "order-health",
  brokers: (process.env.KAFKA_BROKERS || "localhost:19092").split(","),
  logLevel: logLevel.NOTHING,
  connectionTimeout: 1000,
  requestTimeout: 1500,
  retry: { retries: 0 },
}).admin();
let kafkaUp = false,
  stopping = false,
  timer,
  working;
const topic = process.env.KAFKA_ORDER_TOPIC || "order-created";
const app = new OrderApplication({ prisma, product, customer });
const server = new grpc.Server();
const { orderHandlers } = require("./interfaces/order-handlers");
server.addService(
  service("order").service,
  orderHandlers(app, prisma, async () => {
    const cluster = await healthAdmin.describeCluster();
    return cluster.brokers.length > 0;
  }),
);
async function publish() {
  const rows = await prisma.outbox.findMany({
    where: { publishedAt: null },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  for (const row of rows) {
    try {
      await producer.send({
        topic,
        acks: -1,
        messages: [
          { key: String(row.oid), value: JSON.stringify(row.payload) },
        ],
      });
      kafkaUp = true;
      await prisma.outbox.update({
        where: { id: row.id },
        data: { publishedAt: new Date(), lastError: null },
      });
    } catch (e) {
      kafkaUp = false;
      await prisma.outbox.update({
        where: { id: row.id },
        data: {
          attempts: { increment: 1 },
          lastError: e.message.slice(0, 1000),
        },
      });
      throw e;
    }
  }
}
async function tick() {
  try {
    await publish();
    await app.retry();
  } catch (e) {
    console.warn("Order worker:", e.message);
  } finally {
    if (!stopping)
      timer = setTimeout(() => {
        working = tick();
      }, 2000);
  }
}
async function main() {
  await prisma.$connect();
  await producer.connect();
  await healthAdmin.connect();
  kafkaUp = true;
  await listen(server, 50054);
  working = tick();
}
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  const force = setTimeout(() => server.forceShutdown(), 5000);
  await new Promise((r) => server.tryShutdown(r));
  clearTimeout(force);
  await working;
  product.close();
  customer.close();
  await producer.disconnect();
  await healthAdmin.disconnect();
  await prisma.$disconnect();
}
process.on("SIGTERM", () => shutdown().catch(console.error));
process.on("SIGINT", () => shutdown().catch(console.error));
main().catch(async (e) => {
  console.error(e);
  await shutdown();
  process.exitCode = 1;
});
