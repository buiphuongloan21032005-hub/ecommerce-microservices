const path = require("node:path");

require("dotenv").config({
  path: path.join(__dirname, "../.env"),
});

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const { prisma } = require("./infrastructure/prisma");

const { CustomerRepository } = require("./infrastructure/customer-repository");

const { CustomerApplication } = require("./application/customer-application");

const { createCustomerHandlers } = require("./interfaces/customer-handlers");

const protoPath = path.join(__dirname, "../../../proto/customer.proto");

const definition = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: false,
  oneofs: true,
});

const customerPackage = grpc.loadPackageDefinition(definition).customer;

const repository = new CustomerRepository(prisma);

const application = new CustomerApplication({
  repository,
});

const server = new grpc.Server();

server.addService(
  customerPackage.CustomerService.service,
  createCustomerHandlers(application, prisma),
);

async function main() {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;

  const host = process.env.GRPC_HOST || "127.0.0.1";
  const port = process.env.GRPC_PORT || "50052";
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

  console.log("Customer database connected");
  console.log(`Customer gRPC server listening on ${address}`);
}

let stopping = false;

function shutdown(signal) {
  if (stopping) return;
  stopping = true;

  console.log(`Stopping Customer Service: ${signal}`);

  const timer = setTimeout(() => {
    server.forceShutdown();
  }, 5000);

  server.tryShutdown(async (error) => {
    clearTimeout(timer);

    if (error) {
      server.forceShutdown();
    }

    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      console.error(disconnectError);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch(async (error) => {
  console.error("Cannot start Customer Service:", error);
  server.forceShutdown();

  await prisma.$disconnect();
  process.exitCode = 1;
});
