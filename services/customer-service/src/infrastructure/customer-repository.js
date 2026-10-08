class CustomerRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  findByUid(uid) {
    return this.prisma.customer.findUnique({
      where: { uid },
      include: {
        membership: true,
      },
    });
  }

  findMembershipById(mid) {
    return this.prisma.memberShip.findUnique({
      where: { mid },
    });
  }

  findMembershipByName(mname) {
    return this.prisma.memberShip.findUnique({
      where: { mname },
    });
  }

  create({ uid, fullname, mid }) {
    return this.prisma.customer.create({
      data: {
        uid,
        fullname,
        mid,
      },
      include: {
        membership: true,
      },
    });
  }

  update(uid, changes) {
    return this.prisma.customer.update({
      where: { uid },
      data: changes,
      include: {
        membership: true,
      },
    });
  }
}

module.exports = { CustomerRepository };
