const {
  AuthError,
  validateCredentials,
  validateContact,
} = require("../domain/credentials");

function validateRegistrationFullname(value, username) {
  // Nếu không cung cấp họ tên, dùng username làm tên ban đầu.
  if (value === undefined || value === "") {
    return username;
  }

  if (typeof value !== "string") {
    throw new AuthError("INVALID_INPUT", "Họ tên phải là chuỗi.");
  }

  const fullname = value.trim();

  if (fullname.length === 0 || fullname.length > 100) {
    throw new AuthError("INVALID_INPUT", "Họ tên phải có từ 1 đến 100 ký tự.");
  }

  return fullname;
}

class AuthApplication {
  constructor({ repository, security, provisioner }) {
    this.repository = repository;
    this.security = security;
    this.provisioner = provisioner;
  }

  async register(input) {
    const { username, password } = validateCredentials(input);
    const { email, phone } = validateContact(input);

    const fullname = validateRegistrationFullname(input.fullname, username);

    const existing = await this.repository.findByUsername(username);

    if (existing) {
      throw new AuthError("CONFLICT", "Tên đăng nhập đã tồn tại.");
    }

    const role = await this.repository.findRoleByName("normal");

    if (!role) {
      throw new Error("Chưa khởi tạo vai trò normal.");
    }

    const passwordHash = await this.security.hashPassword(password);

    let user;

    try {
      user = await this.repository.createWithCustomerJob({
        username,
        password: passwordHash,
        email,
        phone,
        roleid: role.roleid,
        fullname,
      });
    } catch (error) {
      if (error.code === "P2002") {
        throw new AuthError("CONFLICT", "Tên đăng nhập hoặc email đã tồn tại.");
      }

      throw error;
    }

    const completed = await this.provisioner.processUid(user.uid);

    if (!completed) {
      throw new AuthError(
        "UNAVAILABLE",
        "Tài khoản đã được lưu, hồ sơ khách hàng đang chờ hoàn tất. Hãy thử đăng nhập sau.",
      );
    }

    return {
      message: "Đăng ký thành công.",
      uid: user.uid,
    };
  }

  async login(input) {
    const { username, password } = validateCredentials(input);

    const user = await this.repository.findByUsername(username);

    if (
      !user ||
      !(await this.security.comparePassword(password, user.password))
    ) {
      throw new AuthError(
        "UNAUTHENTICATED",
        "Tên đăng nhập hoặc mật khẩu không đúng.",
      );
    }

    // Chỉ xử lý hồ sơ sau khi mật khẩu đã được xác thực.
    const completed = await this.provisioner.processUid(user.uid);

    if (!completed) {
      throw new AuthError(
        "UNAVAILABLE",
        "Hồ sơ khách hàng đang chờ hoàn tất. Hãy thử lại sau.",
      );
    }

    return this.security.createToken(user);
  }

  async getUser(input) {
    if (!Number.isInteger(input.uid) || input.uid <= 0) {
      throw new AuthError("INVALID_INPUT", "uid phải là số nguyên dương.");
    }

    const user = await this.repository.findById(input.uid);

    if (!user) {
      throw new AuthError("NOT_FOUND", "Không tìm thấy người dùng.");
    }

    return {
      uid: user.uid,
      username: user.username,
      role: user.role.rolename,
    };
  }
}

module.exports = { AuthApplication };
