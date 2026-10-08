class ShipmentRepository {
  constructor(db) {
    this.db = db;
    this.shipments = db.collection("Shipment");
  }
  async initialize() {
    await this.shipments.createIndex({ oid: 1 }, { unique: true });
    await this.shipments.createIndex({ shipid: 1 }, { unique: true });
  }
  find(filter) {
    return this.shipments.findOne(filter);
  }
  update(shipid, old, status) {
    return this.shipments.findOneAndUpdate(
      { shipid, status: old },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: "after", includeResultMetadata: false },
    );
  }
  async createFromEvent(event) {
    const existing = await this.find({ oid: event.oid });
    if (existing) {
      if (existing.uid !== event.uid)
        throw new Error("Duplicate oid has different owner");
      return existing;
    }
    const counter = await this.db
      .collection("Counter")
      .findOneAndUpdate(
        { _id: "shipment_id" },
        { $inc: { sequence: 1 } },
        { upsert: true, returnDocument: "after", includeResultMetadata: false },
      );
    if (counter.sequence > 2147483647) throw new Error("shipid exhausted");
    try {
      await this.shipments.updateOne(
        { oid: event.oid },
        {
          $setOnInsert: {
            shipid: counter.sequence,
            oid: event.oid,
            uid: event.uid,
            eventId: event.eventId,
            status: "PENDING",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (e) {
      if (e.code !== 11000) throw e;
      const saved = await this.find({ oid: event.oid });
      if (!saved || saved.uid !== event.uid) throw e;
    }
    return this.find({ oid: event.oid });
  }
}
module.exports = { ShipmentRepository };
