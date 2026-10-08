const grpc = require("@grpc/grpc-js");
const { CustomerError } = require("../domain/customer");

const errorCodes = {
  INVALID_INPUT: grpc.status.INVALID_ARGUMENT,
  CONFLICT: grpc.status.ALREADY_EXISTS,
  NOT_FOUND: grpc.status.NOT_FOUND,
};

function handle(action) {
  return async (call, callback) => {
    try {
      const result = await action(call.request);
      callback(null, result);
    } catch (error) {
      if (error instanceof CustomerError) {
        callback({
          code: errorCodes[error.type] ?? grpc.status.INTERNAL,
          details: error.message,
        });
        return;
      }

      console.error("Customer request failed:", error);

      callback({
        code: grpc.status.INTERNAL,
        details: "Lỗi nội bộ Customer Service.",
      });
    }
  };
}

function membershipData(request, update) {
  const data = {};
  if (!update || Object.hasOwn(request, "mname")) {
    if (
      typeof request.mname !== "string" ||
      !request.mname.trim() ||
      request.mname.trim().length > 50
    )
      throw new CustomerError("INVALID_INPUT", "Invalid membership name");
    data.mname = request.mname.trim();
  }
  if (!update || Object.hasOwn(request, "score")) {
    if (
      !Number.isInteger(request.score) ||
      request.score < 0 ||
      request.score > 2147483647
    )
      throw new CustomerError("INVALID_INPUT", "Invalid score");
    data.score = request.score;
  }
  if (!Object.keys(data).length)
    throw new CustomerError("INVALID_INPUT", "No membership changes");
  return data;
}
function createCustomerHandlers(application, prisma) {
  return {
    CreateCustomer: handle((request) => application.createCustomer(request)),

    GetCustomer: handle((request) => application.getCustomer(request)),

    UpdateCustomer: handle((request) => application.updateCustomer(request)),

    GetMembership: handle((request) => application.getMembership(request)),

    CreateMembership: handle(async (request) => {
      const data = membershipData(request, false);
      try {
        return await prisma.memberShip.create({ data });
      } catch (e) {
        if (e.code === "P2002")
          throw new CustomerError("CONFLICT", "Membership name already exists");
        throw e;
      }
    }),
    UpdateMembership: handle(async (request) => {
      const { validateMid } = require("../domain/customer");
      const mid = validateMid(request.mid);
      const data = membershipData(request, true);
      const current = await prisma.memberShip.findUnique({ where: { mid } });
      if (!current)
        throw new CustomerError("NOT_FOUND", "Membership not found");
      if (
        current.mname === "normal" &&
        ((data.mname && data.mname !== "normal") ||
          (data.score !== undefined && data.score !== 10))
      )
        throw new CustomerError(
          "INVALID_INPUT",
          "Default normal membership must keep score 10",
        );
      try {
        return await prisma.memberShip.update({ where: { mid }, data });
      } catch (e) {
        if (e.code === "P2002")
          throw new CustomerError("CONFLICT", "Membership name already exists");
        throw e;
      }
    }),
    Health: async (_call, callback) => {
      try {
        await prisma.$queryRaw`SELECT 1`;

        callback(null, {
          status: "UP",
        });
      } catch (error) {
        console.error("Customer health check failed:", error);

        callback({
          code: grpc.status.UNAVAILABLE,
          details: "Customer database chưa sẵn sàng.",
        });
      }
    },
  };
}

module.exports = { createCustomerHandlers };
