-- #channel mentions: a span that references a channel by id. Its text is
-- always NULL, so no channel name is ever stored (or indexed for search);
-- readers resolve the name from the channels they can see.
-- AlterEnum
ALTER TYPE "SpanType" ADD VALUE 'CHANNEL_MENTION';

-- AlterTable
ALTER TABLE "MessageSpan" ADD COLUMN     "channelId" TEXT;

-- CreateIndex
CREATE INDEX "MessageSpan_channelId_idx" ON "MessageSpan"("channelId");

-- AddForeignKey
ALTER TABLE "MessageSpan" ADD CONSTRAINT "MessageSpan_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
