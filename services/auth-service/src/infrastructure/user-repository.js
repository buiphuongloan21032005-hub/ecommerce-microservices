class UserRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  findByUsername(username) {
    return this.prisma.user.findUnique({
      where: { username },
      include: { role: true },
    });
  }

  findById(uid) {
    return this.prisma.user.findUnique({
      where: { uid },
      select: {
        uid: true,
        username: true,
        role: {
          select: {
            rolename: true,
          },
        },
      },
    });
  }

  findRoleByName(rolename) {
    return this.prisma.role.findUnique({
      where: { rolename },
    });
  }

  create({ username, password, email, phone, roleid }) {
    return this.prisma.user.create({
      data: {
        username,
        password,
        email,
        phone,
        roleid,
      },
      select: {
        uid: true,
        username: true,
      },
    });
  }
  createWithCustomerJob({
    username,
    password,
    email,
    phone,
    roleid,
    fullname,
  }) {
    return this.prisma.user.create({
      data: {
        username,
        password,
        email,
        phone,
        roleid,

        customerJob: {
          create: {
            fullname,
          },
        },
      },
      select: {
        uid: true,
        username: true,
      },
    });
  }

  findCustomerJob(uid) {
    return this.prisma.customerProvisioning.findUnique({
      where: { uid },
    });
  }

  findPendingCustomerJobs() {
    return this.prisma.customerProvisioning.findMany({
      where: {
        completedAt: null,
      },
      orderBy: [{ attempts: "asc" }, { createdAt: "asc" }],
      take: 20,
    });
  }

  completeCustomerJob(uid) {
    return this.prisma.customerProvisioning.update({
      where: { uid },
      data: {
        completedAt: new Date(),
        lastError: null,
      },
    });
  }

  recordCustomerJobFailure(uid, message) {
    return this.prisma.customerProvisioning.updateMany({
      where: {
        uid,
        completedAt: null,
      },
      data: {
        attempts: {
          increment: 1,
        },
        lastError: String(message).slice(0, 1000),
      },
    });
  }
}

module.exports = UserRepository;
