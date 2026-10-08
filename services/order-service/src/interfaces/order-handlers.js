const { grpc, handle, fail } = require("../../../../shared/rpc");
function orderHandlers(app, prisma, isKafkaUp) {
  return {
    CreateOrder: handle((i) => app.create(i)),
    ListOrders: handle((i) => app.list(i)),
    GetOrder: handle((i) => app.get(i)),
    Health: handle(async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        if (!(await isKafkaUp())) throw new Error("Kafka unavailable");
      } catch {
        throw fail(
          grpc.status.UNAVAILABLE,
          "Order database or Kafka unavailable",
        );
      }
      return { status: "UP" };
    }),
  };
}
module.exports = { orderHandlers };
