const path = require("node:path");

require("dotenv").config({
  path: path.join(__dirname, "..", ".env"),
});

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const prisma = require("./infrastructure/prisma");
const UserRepository = require("./infrastructure/user-repository");
const createSecurity = require("./infrastructure/security");
const createAuthHandlers = require("./interfaces/auth-handlers");

const { AuthApplication } = require("./application/auth-application");

const { CustomerClient } = require("./infrastructure/customer-client");

const { CustomerProvisioner } = require("./application/customer-provisioner");

const protoPath = path.join(__dirname, "../../../proto/auth.proto");

const definition = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: false,
  oneofs: true,
});

const authPackage = grpc.loadPackageDefinition(definition).auth;

const repository = new UserRepository(prisma);

const security = createSecurity({
  secret: process.env.JWT_SECRET,
  expiresIn: process.env.JWT_EXPIRES_IN || "1h",
});

const customerClient = new CustomerClient(process.env.CUSTOMER_GRPC_ADDRESS);

const provisioner = new CustomerProvisioner({
  repository,
  customerClient,
});

const application = new AuthApplication({
  repository,
  security,
  provisioner,
});

const server = new grpc.Server();

server.addService(
  authPackage.AuthService.service,
  createAuthHandlers(application, prisma),
);

async function main() {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;

  const host = process.env.GRPC_HOST || "127.0.0.1";
  const port = process.env.GRPC_PORT || "50051";
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

  provisioner.start();

  console.log("Auth database connected");
  console.log(`Auth gRPC server listening on ${address}`);
  console.log("Customer provisioning retry started");
}

async function closeResources() {
  try {
    await provisioner.stop();
  } finally {
    customerClient.close();
    await prisma.$disconnect();
  }
}

let stopping = false;

function shutdown() {
  if (stopping) return;
  stopping = true;

  console.log("Stopping Auth Service...");

  const timer = setTimeout(() => {
    server.forceShutdown();
  }, 5000);

  server.tryShutdown(async (error) => {
    clearTimeout(timer);

    if (error) {
      server.forceShutdown();
    }

    try {
      await closeResources();
    } catch (error) {
      console.error("Auth shutdown failed:", error.message);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch(async (error) => {
  console.error("Auth startup failed:", error.message);
  server.forceShutdown();

  try {
    await closeResources();
  } catch (cleanupError) {
    console.error("Auth cleanup failed:", cleanupError.message);
  }

  process.exitCode = 1;
});
