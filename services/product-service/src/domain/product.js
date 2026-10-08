const Decimal = require("decimal.js");

class ProductError extends Error {
  constructor(type, message) {
    super(message);
    this.name = "ProductError";
    this.type = type;
  }
}

function validatePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid > 2147483647) {
    throw new ProductError(
      "INVALID_INPUT",
      "pid phải là số nguyên dương trong phạm vi int32.",
    );
  }

  return pid;
}

function validatePname(pname) {
  if (typeof pname !== "string") {
    throw new ProductError("INVALID_INPUT", "Tên sản phẩm phải là chuỗi.");
  }

  const value = pname.trim();

  if (value.length === 0 || value.length > 200) {
    throw new ProductError(
      "INVALID_INPUT",
      "Tên sản phẩm phải có từ 1 đến 200 ký tự.",
    );
  }

  return value;
}

function validatePrice(price) {
  if (typeof price !== "string" || !/^\d{1,12}(\.\d{1,2})?$/.test(price)) {
    throw new ProductError(
      "INVALID_INPUT",
      "Giá phải là chuỗi số, tối đa 12 chữ số nguyên và 2 chữ số thập phân.",
    );
  }

  const value = new Decimal(price);

  if (value.lte(0)) {
    throw new ProductError("INVALID_INPUT", "Giá sản phẩm phải lớn hơn 0.");
  }

  return value.toFixed(2);
}

function validateQuantity(quantity) {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 2147483647) {
    throw new ProductError(
      "INVALID_INPUT",
      "Số lượng phải là số nguyên từ 0 đến 2147483647.",
    );
  }

  return quantity;
}

module.exports = {
  ProductError,
  validatePid,
  validatePname,
  validatePrice,
  validateQuantity,
};
