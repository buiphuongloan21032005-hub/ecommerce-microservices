class ProductRepository {
  constructor(db) {
    this.products = db.collection("Product");
    this.counters = db.collection("Counter");
  }

  async initialize() {
    await this.products.createIndex({ pid: 1 }, { unique: true });

    await this.counters.updateOne(
      { _id: "product_pid" },
      { $setOnInsert: { sequence: 0 } },
      { upsert: true },
    );
  }

  async nextPid() {
    const counter = await this.counters.findOneAndUpdate(
      {
        _id: "product_pid",
        sequence: { $lt: 2147483647 },
      },
      {
        $inc: { sequence: 1 },
      },
      {
        returnDocument: "after",
        includeResultMetadata: false,
      },
    );

    if (!counter) {
      throw new Error("Không thể cấp mã sản phẩm mới.");
    }

    return counter.sequence;
  }

  list() {
    return this.products
      .find({ deleted: { $ne: true } }, { projection: { _id: 0 } })
      .sort({ pid: 1 })
      .toArray();
  }

  findByPid(pid) {
    return this.products.findOne(
      { pid, deleted: { $ne: true } },
      { projection: { _id: 0 } },
    );
  }

  async create({ pname, price, quantity }) {
    const pid = await this.nextPid();

    const product = {
      pid,
      pname,
      price,
      quantity,
    };

    await this.products.insertOne({ ...product });

    return product;
  }

  update(pid, changes) {
    return this.products.findOneAndUpdate(
      { pid, deleted: { $ne: true } },
      { $set: changes },
      {
        returnDocument: "after",
        includeResultMetadata: false,
        projection: { _id: 0 },
      },
    );
  }

  delete(pid) {
    return this.products.findOneAndUpdate(
      { pid, deleted: { $ne: true } },
      { $set: { deleted: true } },
      {
        includeResultMetadata: false,
        projection: { _id: 0 },
      },
    );
  }
}

module.exports = { ProductRepository };
