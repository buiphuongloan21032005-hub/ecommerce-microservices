const grpc = require("@grpc/grpc-js");
const { AuthError } = require("../domain/credentials");

const errorCodes = {
  INVALID_INPUT: grpc.status.INVALID_ARGUMENT,
  CONFLICT: grpc.status.ALREADY_EXISTS,
  UNAUTHENTICATED: grpc.status.UNAUTHENTICATED,
  NOT_FOUND: grpc.status.NOT_FOUND,
  UNAVAILABLE: grpc.status.UNAVAILABLE,
};

function handle(action) {
  return async (call, callback) => {
    try {
      const result = await action(call.request);
      callback(null, result);
    } catch (error) {
      if (error instanceof AuthError) {
        callback({
          code: errorCodes[error.type] ?? grpc.status.INTERNAL,
          details: error.message,
        });
        return;
      }

      console.error("Auth request failed:", error.message);

      callback({
        code: grpc.status.INTERNAL,
        details: "Internal server error",
      });
    }
  };
}

function createAuthHandlers(application, prisma) {
  return {
    Register: handle((request) => application.register(request)),
    Login: handle((request) => application.login(request)),
    GetUser: handle((request) => application.getUser(request)),

    Health: async (_call, callback) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        callback(null, { status: "UP" });
      } catch (error) {
        console.error("Auth health check failed:", error.message);

        callback({
          code: grpc.status.UNAVAILABLE,
          details: "Auth database is unavailable",
        });
      }
    },
  };
}

module.exports = createAuthHandlers;
