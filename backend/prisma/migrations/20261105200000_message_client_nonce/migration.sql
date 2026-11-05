-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "clientNonce" TEXT;

-- CreateTable
CREATE TABLE "MessageNonceTombstone" (
    "authorId" TEXT NOT NULL,
    "clientNonce" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageNonceTombstone_pkey" PRIMARY KEY ("authorId","clientNonce")
);

-- CreateIndex: blocks writes to "Message" while it builds, so a very large
-- instance should expect a short pause in sending during the upgrade.
CREATE UNIQUE INDEX "Message_authorId_clientNonce_key" ON "Message"("authorId", "clientNonce");

-- AddForeignKey
ALTER TABLE "MessageNonceTombstone" ADD CONSTRAINT "MessageNonceTombstone_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
