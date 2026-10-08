const { grpc, fail, positive } = require("../../../../shared/rpc");
const {
  validateEvent,
  access,
  transition,
  response,
} = require("../domain/shipment");
class ShipmentApplication {
  constructor(repository) {
    this.repository = repository;
  }
  async find(filter, input) {
    const s = await this.repository.find(filter);
    if (!s) throw fail(grpc.status.NOT_FOUND, "Shipment not found");
    access(s, input);
    return response(s);
  }
  get(i) {
    return this.find({ shipid: positive(i.shipid, "shipid") }, i);
  }
  getByOrder(i) {
    return this.find({ oid: positive(i.oid, "oid") }, i);
  }
  async update(i) {
    const s = await this.repository.find({
      shipid: positive(i.shipid, "shipid"),
    });
    if (!s) throw fail(grpc.status.NOT_FOUND, "Shipment not found");
    access(s, i, true);
    const status = transition(s.status, i.status);
    const updated = await this.repository.update(s.shipid, s.status, status);
    if (!updated)
      throw fail(grpc.status.ABORTED, "Concurrent shipment update; retry");
    return response(updated);
  }
  consume(e) {
    return this.repository.createFromEvent(validateEvent(e));
  }
}
module.exports = { ShipmentApplication };
