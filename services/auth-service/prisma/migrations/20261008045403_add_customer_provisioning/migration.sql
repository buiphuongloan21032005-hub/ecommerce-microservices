-- CreateTable
CREATE TABLE "CustomerProvisioning" (
    "uid" INTEGER NOT NULL,
    "fullname" VARCHAR(100) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerProvisioning_pkey" PRIMARY KEY ("uid")
);

-- CreateIndex
CREATE INDEX "CustomerProvisioning_completedAt_createdAt_idx" ON "CustomerProvisioning"("completedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomerProvisioning" ADD CONSTRAINT "CustomerProvisioning_uid_fkey" FOREIGN KEY ("uid") REFERENCES "User"("uid") ON DELETE CASCADE ON UPDATE CASCADE;
