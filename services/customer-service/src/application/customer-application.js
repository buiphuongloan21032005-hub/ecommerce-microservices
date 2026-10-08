const {
  CustomerError,
  validateUid,
  validateFullname,
  validateMid,
} = require("../domain/customer");

function toCustomerResponse(customer) {
  return {
    uid: customer.uid,
    fullname: customer.fullname,
    mid: customer.mid,
    membership: {
      mid: customer.membership.mid,
      mname: customer.membership.mname,
      score: customer.membership.score,
    },
  };
}

class CustomerApplication {
  constructor({ repository }) {
    this.repository = repository;
  }

  async createCustomer(input) {
    const uid = validateUid(input.uid);
    const fullname = validateFullname(input.fullname);

    const membership = await this.repository.findMembershipByName("normal");

    if (!membership) {
      throw new Error("Chưa khởi tạo hạng thành viên normal.");
    }

    // Không cho luồng đăng ký tự chọn hạng khác.
    // Trường mid không được gửi trong proto sẽ có thể là 0.
    if (
      input.mid !== undefined &&
      input.mid !== 0 &&
      input.mid !== membership.mid
    ) {
      throw new CustomerError(
        "INVALID_INPUT",
        "Khách hàng mới phải sử dụng hạng mặc định.",
      );
    }

    const existing = await this.repository.findByUid(uid);

    if (existing) {
      // Cho phép gọi lại cùng yêu cầu mà không tạo bản ghi trùng.
      if (existing.fullname === fullname && existing.mid === membership.mid) {
        return toCustomerResponse(existing);
      }

      throw new CustomerError("CONFLICT", "uid này đã có hồ sơ khách hàng.");
    }

    try {
      const customer = await this.repository.create({
        uid,
        fullname,
        mid: membership.mid,
      });

      return toCustomerResponse(customer);
    } catch (error) {
      if (error.code === "P2002") {
        // Xử lý khi hai yêu cầu cùng tạo một uid.
        const customer = await this.repository.findByUid(uid);

        if (
          customer &&
          customer.fullname === fullname &&
          customer.mid === membership.mid
        ) {
          return toCustomerResponse(customer);
        }

        throw new CustomerError("CONFLICT", "uid này đã có hồ sơ khách hàng.");
      }

      throw error;
    }
  }

  async getCustomer(input) {
    const uid = validateUid(input.uid);

    const customer = await this.repository.findByUid(uid);

    if (!customer) {
      throw new CustomerError("NOT_FOUND", "Không tìm thấy khách hàng.");
    }

    return toCustomerResponse(customer);
  }

  async updateCustomer(input) {
    const uid = validateUid(input.uid);
    const changes = {};

    if (Object.hasOwn(input, "fullname")) {
      changes.fullname = validateFullname(input.fullname);
    }

    if (Object.hasOwn(input, "mid")) {
      const mid = validateMid(input.mid);

      const membership = await this.repository.findMembershipById(mid);

      if (!membership) {
        throw new CustomerError("NOT_FOUND", "Không tìm thấy hạng thành viên.");
      }

      changes.mid = mid;
    }

    if (Object.keys(changes).length === 0) {
      throw new CustomerError(
        "INVALID_INPUT",
        "Cần cung cấp fullname hoặc mid để cập nhật.",
      );
    }

    try {
      const customer = await this.repository.update(uid, changes);

      return toCustomerResponse(customer);
    } catch (error) {
      if (error.code === "P2025") {
        throw new CustomerError("NOT_FOUND", "Không tìm thấy khách hàng.");
      }

      throw error;
    }
  }

  async getMembership(input) {
    const mid = validateMid(input.mid);

    const membership = await this.repository.findMembershipById(mid);

    if (!membership) {
      throw new CustomerError("NOT_FOUND", "Không tìm thấy hạng thành viên.");
    }

    return {
      mid: membership.mid,
      mname: membership.mname,
      score: membership.score,
    };
  }
}

module.exports = { CustomerApplication };
