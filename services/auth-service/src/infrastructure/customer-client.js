const path = require("node:path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const definition = protoLoader.loadSync(
  path.join(__dirname, "../../../../proto/customer.proto"),
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
  },
);

const customerPackage = grpc.loadPackageDefinition(definition).customer;

class CustomerClient {
  constructor(address) {
    if (!address) {
      throw new Error("Thiếu CUSTOMER_GRPC_ADDRESS.");
    }

    this.client = new customerPackage.CustomerService(
      address,
      grpc.credentials.createInsecure(),
    );
  }

  call(method, request) {
    return new Promise((resolve, reject) => {
      this.client[method](
        request,
        {
          deadline: new Date(Date.now() + 5000),
        },
        (error, response) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(response);
        },
      );
    });
  }

  health() {
    return this.call("Health", {});
  }

  createCustomer({ uid, fullname }) {
    return this.call("CreateCustomer", {
      uid,
      fullname,
    });
  }

  close() {
    this.client.close();
  }
}

module.exports = { CustomerClient };
