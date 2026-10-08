const { grpc, handle, fail } = require("../../../../shared/rpc");
function shipmentHandlers(app, db, isKafkaUp) {
  return {
    GetShipment: handle((i) => app.get(i)),
    GetShipmentByOrder: handle((i) => app.getByOrder(i)),
    UpdateShipmentStatus: handle((i) => app.update(i)),
    Health: handle(async () => {
      await db.command({ ping: 1 });
      if (!isKafkaUp())
        throw fail(grpc.status.UNAVAILABLE, "Kafka consumer not ready");
      return { status: "UP" };
    }),
  };
}
module.exports = { shipmentHandlers };
