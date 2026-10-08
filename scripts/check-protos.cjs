const path = require("node:path");
const protoLoader = require("@grpc/proto-loader");

const contracts = [
  ["auth.proto", "auth.AuthService"],
  ["customer.proto", "customer.CustomerService"],
  ["product.proto", "product.ProductService"],
  ["order.proto", "order.OrderService"],
  ["shipment.proto", "shipment.ShipmentService"],
];

let failed = false;

for (const [filename, serviceName] of contracts) {
  const filePath = path.join(__dirname, "..", "proto", filename);

  try {
    const definition = protoLoader.loadSync(filePath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: false,
      oneofs: true,
    });

    const service = definition[serviceName];

    if (!service) {
      throw new Error(`Không tìm thấy service: ${serviceName}`);
    }

    const methods = Object.keys(service);

    if (methods.length === 0) {
      throw new Error("Service chưa có phương thức");
    }

    console.log(`OK: ${filename}`);
    console.log(`  Methods: ${methods.join(", ")}`);
  } catch (error) {
    failed = true;
    console.error(`ERROR: ${filename}`);
    console.error(`  ${error.message}`);
  }
}

if (failed) {
  console.error("\nKiểm tra thất bại. Hãy sửa các lỗi phía trên.");
  process.exitCode = 1;
} else {
  console.log("\nĐã nạp thành công cả 5 file proto.");
}
