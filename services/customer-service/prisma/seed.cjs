const path = require("node:path");

require("dotenv").config({
  path: path.join(__dirname, "../.env"),
});

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  await prisma.memberShip.upsert({
    where: {
      mname: "normal",
    },
    update: {
      score: 10,
    },
    create: {
      mname: "normal",
      score: 10,
    },
  });

  const memberships = await prisma.memberShip.findMany({
    orderBy: {
      mid: "asc",
    },
  });

  console.table(memberships);
  console.log("Đã khởi tạo hạng thành viên mặc định.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
