class AuthError extends Error {
  constructor(type, message) {
    super(message);
    this.name = "AuthError";
    this.type = type;
  }
}

function validateCredentials(input) {
  if (!input || typeof input.username !== "string") {
    throw new AuthError("INVALID_INPUT", "Username is required");
  }

  const username = input.username.trim();

  if (!username || username.length > 50) {
    throw new AuthError(
      "INVALID_INPUT",
      "Username must contain 1 to 50 characters",
    );
  }

  if (
    typeof input.password !== "string" ||
    input.password.trim().length === 0
  ) {
    throw new AuthError("INVALID_INPUT", "Password is required");
  }

  if (Buffer.byteLength(input.password, "utf8") > 72) {
    throw new AuthError(
      "INVALID_INPUT",
      "Password must not exceed 72 UTF-8 bytes",
    );
  }

  return {
    username,
    password: input.password,
  };
}

function validateContact(input) {
  const email = input.email?.trim() || null;
  const phone = input.phone?.trim() || null;

  if (
    email &&
    (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  ) {
    throw new AuthError("INVALID_INPUT", "Email is invalid");
  }

  if (phone && !/^0\d{9}$/.test(phone)) {
    throw new AuthError(
      "INVALID_INPUT",
      "Phone must contain 10 digits and start with 0",
    );
  }

  return { email, phone };
}

module.exports = {
  AuthError,
  validateCredentials,
  validateContact,
};
