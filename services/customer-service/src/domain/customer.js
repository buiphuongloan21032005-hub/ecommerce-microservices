class CustomerError extends Error {
  constructor(type, message) {
    super(message);
    this.name = "CustomerError";
    this.type = type;
  }
}

function validateUid(uid) {
  if (!Number.isInteger(uid) || uid <= 0) {
    throw new CustomerError("INVALID_INPUT", "uid phải là số nguyên dương.");
  }

  return uid;
}

function validateFullname(fullname) {
  if (typeof fullname !== "string") {
    throw new CustomerError("INVALID_INPUT", "Họ tên phải là chuỗi.");
  }

  const value = fullname.trim();

  if (value.length === 0 || value.length > 100) {
    throw new CustomerError(
      "INVALID_INPUT",
      "Họ tên phải có từ 1 đến 100 ký tự.",
    );
  }

  return value;
}

function validateMid(mid) {
  if (!Number.isInteger(mid) || mid <= 0) {
    throw new CustomerError("INVALID_INPUT", "mid phải là số nguyên dương.");
  }

  return mid;
}

module.exports = {
  CustomerError,
  validateUid,
  validateFullname,
  validateMid,
};
