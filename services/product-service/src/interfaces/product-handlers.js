const grpc = require("@grpc/grpc-js");
const { ProductError } = require("../domain/product");

const errorCodes = {
  INVALID_INPUT: grpc.status.INVALID_ARGUMENT,
  NOT_FOUND: grpc.status.NOT_FOUND,
  CONFLICT: grpc.status.ALREADY_EXISTS,
  STOCK_CONFLICT: grpc.status.FAILED_PRECONDITION,
};

function handle(action) {
  return async (call, callback) => {
    try {
      const result = await action(call.request);
      callback(null, result);
    } catch (error) {
      if (error instanceof ProductError) {
        callback({
          code: errorCodes[error.type] ?? grpc.status.INTERNAL,
          details: error.message,
        });
        return;
      }

      console.error("Product request failed:", error);

      callback({
        code: grpc.status.INTERNAL,
        details: "Lỗi nội bộ Product Service.",
      });
    }
  };
}

function createProductHandlers(application, db, stock) {
  return {
    ListProducts: handle(() => application.listProducts()),

    GetProduct: handle((request) => application.getProduct(request)),

    CreateProduct: handle((request) => application.createProduct(request)),

    UpdateProduct: handle((request) => application.updateProduct(request)),

    DeleteProduct: handle((request) => application.deleteProduct(request)),

    ReserveStock: handle((request) => stock.reserve(request)),
    ReleaseStock: handle((request) => stock.release(request)),

    Health: async (_call, callback) => {
      try {
        await db.command({ ping: 1 });

        callback(null, {
          status: "UP",
        });
      } catch (error) {
        console.error("Product health check failed:", error.message);

        callback({
          code: grpc.status.UNAVAILABLE,
          details: "Product database chưa sẵn sàng.",
        });
      }
    },
  };
}

module.exports = { createProductHandlers };
