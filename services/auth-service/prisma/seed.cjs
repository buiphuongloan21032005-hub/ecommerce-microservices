const path = require("node:path");

require("dotenv").config({
  path: path.join(__dirname, "..", ".env"),
});

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const roleNames = ["normal", "admin", "shipment_staff"];

  for (const rolename of roleNames) {
    await prisma.role.upsert({
      where: { rolename },
      update: {},
      create: { rolename },
    });
  }

  for (const [prefix, rolename] of [
    ["ADMIN", "admin"],
    ["STAFF", "shipment_staff"],
  ]) {
    const username = process.env[prefix + "_USERNAME"],
      password = process.env[prefix + "_PASSWORD"];
    if (!username || !password) continue;
    const role = await prisma.role.findUnique({ where: { rolename } });
    // Never overwrite an existing user's password or role on restart.
    await prisma.user.upsert({
      where: { username },
      update: {},
      create: {
        username,
        password: await require("bcryptjs").hash(password, 12),
        roleid: role.roleid,
        customerJob: { create: { fullname: username } },
      },
    });
  }

  const roles = await prisma.role.findMany({
    orderBy: { roleid: "asc" },
  });

  console.table(roles);
  console.log("Đã khởi tạo các vai trò.");
}

main()
  .catch((error) => {
    console.error("Khởi tạo vai trò thất bại:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
