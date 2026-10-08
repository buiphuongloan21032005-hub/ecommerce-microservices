-- CreateTable
CREATE TABLE "MemberShip" (
    "mid" SERIAL NOT NULL,
    "mname" VARCHAR(50) NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 10,

    CONSTRAINT "MemberShip_pkey" PRIMARY KEY ("mid")
);

-- CreateTable
CREATE TABLE "Customer" (
    "uid" INTEGER NOT NULL,
    "fullname" VARCHAR(100) NOT NULL,
    "mid" INTEGER NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("uid")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberShip_mname_key" ON "MemberShip"("mname");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_mid_fkey" FOREIGN KEY ("mid") REFERENCES "MemberShip"("mid") ON DELETE RESTRICT ON UPDATE CASCADE;
