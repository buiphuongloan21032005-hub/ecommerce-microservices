const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

function createSecurity({ secret, expiresIn = "1h" }) {
  if (!secret) {
    throw new Error("JWT_SECRET is required");
  }

  return {
    hashPassword(password) {
      return bcrypt.hash(password, 12);
    },

    comparePassword(password, hash) {
      return bcrypt.compare(password, hash);
    },

    createToken(user) {
      const token = jwt.sign({ role: user.role.rolename }, secret, {
        algorithm: "HS256",
        subject: String(user.uid),
        expiresIn,
      });

      const payload = jwt.verify(token, secret, {
        algorithms: ["HS256"],
      });

      return {
        access_token: token,
        token_type: "Bearer",
        expires_in: payload.exp - payload.iat,
      };
    },
  };
}

module.exports = createSecurity;
