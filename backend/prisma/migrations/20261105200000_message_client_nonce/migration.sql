-- Add the nullable column and the tombstone table only. The unique index over
-- "Message" is built in 20261105200100_message_client_nonce_index with
-- CREATE INDEX CONCURRENTLY, so sending and reading stay available while it
-- builds; this migration takes its locks briefly and holds none on the table
-- afterwards.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "clientNonce" TEXT;

-- CreateTable
CREATE TABLE "MessageNonceTombstone" (
    "authorId" TEXT NOT NULL,
    "clientNonce" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageNonceTombstone_pkey" PRIMARY KEY ("authorId","clientNonce")
);

-- AddForeignKey
ALTER TABLE "MessageNonceTombstone" ADD CONSTRAINT "MessageNonceTombstone_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
