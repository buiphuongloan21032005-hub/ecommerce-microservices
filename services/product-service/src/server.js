const path = require("node:path");

require("dotenv").config({
  path: path.join(__dirname, "../.env"),
});

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const {
  client,
  db,
  connectMongo,
  closeMongo,
} = require("./infrastructure/mongo");

const { ProductRepository } = require("./infrastructure/product-repository");

const { ProductApplication } = require("./application/product-application");

const { createProductHandlers } = require("./interfaces/product-handlers");

const definition = protoLoader.loadSync(
  path.join(__dirname, "../../../proto/product.proto"),
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
  },
);

const productPackage = grpc.loadPackageDefinition(definition).product;

const repository = new ProductRepository(db);

const application = new ProductApplication({
  repository,
});

const { StockApplication } = require("./application/stock");
const stock = new StockApplication({ client, db });
const server = new grpc.Server();

server.addService(
  productPackage.ProductService.service,
  createProductHandlers(application, db, stock),
);

async function main() {
  await connectMongo();
  await repository.initialize();
  await stock.initialize();

  const host = process.env.GRPC_HOST || "127.0.0.1";
  const port = process.env.GRPC_PORT || "50053";
  const address = `${host}:${port}`;

  await new Promise((resolve, reject) => {
    server.bindAsync(
      address,
      grpc.ServerCredentials.createInsecure(),
      (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      },
    );
  });

  console.log("Product MongoDB connected");
  console.log(`Product gRPC server listening on ${address}`);
}

let stopping = false;

function shutdown() {
  if (stopping) return;
  stopping = true;

  console.log("Stopping Product Service...");

  const timer = setTimeout(() => {
    server.forceShutdown();
  }, 5000);

  server.tryShutdown(async (error) => {
    clearTimeout(timer);

    if (error) {
      server.forceShutdown();
    }

    try {
      await closeMongo();
    } catch (error) {
      console.error("Product shutdown failed:", error.message);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch(async (error) => {
  console.error("Product startup failed:", error.message);
  server.forceShutdown();

  try {
    await closeMongo();
  } catch (cleanupError) {
    console.error("Product cleanup failed:", cleanupError.message);
  }

  process.exitCode = 1;
});
