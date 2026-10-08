const {
  ProductError,
  validatePid,
  validatePname,
  validatePrice,
  validateQuantity,
} = require("../domain/product");

function toProductResponse(product) {
  return {
    pid: product.pid,
    pname: product.pname,
    price: product.price,
    quantity: product.quantity,
  };
}

class ProductApplication {
  constructor({ repository }) {
    this.repository = repository;
  }

  async listProducts() {
    const products = await this.repository.list();

    return {
      items: products.map(toProductResponse),
    };
  }

  async getProduct(input) {
    const pid = validatePid(input.pid);

    const product = await this.repository.findByPid(pid);

    if (!product) {
      throw new ProductError("NOT_FOUND", "Không tìm thấy sản phẩm.");
    }

    return toProductResponse(product);
  }

  async createProduct(input) {
    const pname = validatePname(input.pname);
    const price = validatePrice(input.price);
    const quantity = validateQuantity(input.quantity);

    const product = await this.repository.create({
      pname,
      price,
      quantity,
    });

    return toProductResponse(product);
  }

  async updateProduct(input) {
    const pid = validatePid(input.pid);
    const changes = {};

    if (Object.hasOwn(input, "pname")) {
      changes.pname = validatePname(input.pname);
    }

    if (Object.hasOwn(input, "price")) {
      changes.price = validatePrice(input.price);
    }

    if (Object.hasOwn(input, "quantity")) {
      changes.quantity = validateQuantity(input.quantity);
    }

    if (Object.keys(changes).length === 0) {
      throw new ProductError(
        "INVALID_INPUT",
        "Cần cung cấp trường dữ liệu để cập nhật.",
      );
    }

    const product = await this.repository.update(pid, changes);

    if (!product) {
      throw new ProductError("NOT_FOUND", "Không tìm thấy sản phẩm.");
    }

    return toProductResponse(product);
  }

  async deleteProduct(input) {
    const pid = validatePid(input.pid);

    const product = await this.repository.delete(pid);

    if (!product) {
      throw new ProductError("NOT_FOUND", "Không tìm thấy sản phẩm.");
    }

    return {
      message: "Đã xóa sản phẩm.",
      pid,
    };
  }
}

module.exports = { ProductApplication };
