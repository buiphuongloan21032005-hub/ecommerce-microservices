require("dotenv").config({
  path: require("node:path").join(__dirname, "../.env"),
});
const { MongoClient } = require("mongodb");
const { Kafka, logLevel } = require("kafkajs");
const {
  grpc,
  service,
  handle,
  listen,
  fail,
  positive,
} = require("../../../shared/rpc");
const {
  validateEvent,
  access,
  transition,
  response,
} = require("./domain/shipment");
const mongo = new MongoClient(
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27019",
  { serverSelectionTimeoutMS: 5000 },
);
const db = mongo.db(process.env.MONGODB_DATABASE || "shipment_db");
const { ShipmentRepository } = require("./infrastructure/shipment-repository");
const repository = new ShipmentRepository(db);
const { ShipmentApplication } = require("./application/shipment-application");
const app = new ShipmentApplication(repository);
const consumer = new Kafka({
  clientId: "shipment-service",
  brokers: (process.env.KAFKA_BROKERS || "localhost:19092").split(","),
  logLevel: logLevel.WARN,
}).consumer({ groupId: "shipment-service-v1", allowAutoTopicCreation: false });
let kafkaUp = false,
  stopping = false;
consumer.on(consumer.events.GROUP_JOIN, () => {
  kafkaUp = true;
});
consumer.on(consumer.events.CRASH, () => {
  kafkaUp = false;
});
consumer.on(consumer.events.DISCONNECT, () => {
  kafkaUp = false;
});
const { shipmentHandlers } = require("./interfaces/shipment-handlers");
const server = new grpc.Server();
server.addService(
  service("shipment").service,
  shipmentHandlers(app, db, () => kafkaUp),
);
async function consume({ message }) {
  let event;
  try {
    event = validateEvent(JSON.parse(message.value?.toString() || ""));
  } catch (e) {
    console.error("Rejected OrderCreated:", e.message);
    await db
      .collection("RejectedEvent")
      .updateOne(
        { _id: message.offset + ":" + message.partition },
        {
          $set: {
            reason: e.message,
            body: message.value?.toString(),
            rejectedAt: new Date(),
          },
        },
        { upsert: true },
      );
    return;
  }
  await app.consume(event);
}
async function main() {
  await mongo.connect();
  await repository.initialize();
  await consumer.connect();
  await consumer.subscribe({
    topic: process.env.KAFKA_ORDER_TOPIC || "order-created",
    fromBeginning: true,
  });
  await consumer.run({
    eachMessage: async (payload) =>
      consume({
        ...payload,
        message: { ...payload.message, partition: payload.partition },
      }),
  });
  await listen(server, 50055);
}
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const force = setTimeout(() => server.forceShutdown(), 5000);
  await new Promise((r) => server.tryShutdown(r));
  clearTimeout(force);
  await consumer.disconnect();
  await mongo.close();
}
process.on("SIGTERM", () => shutdown().catch(console.error));
process.on("SIGINT", () => shutdown().catch(console.error));
main().catch(async (e) => {
  console.error(e);
  await shutdown();
  process.exitCode = 1;
});
