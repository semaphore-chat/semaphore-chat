-- AlterTable
ALTER TABLE "InstanceSettings" ALTER COLUMN "name" SET DEFAULT 'Semaphore Chat';

-- Restore the tsvector generated column and GIN index for full-text search.
-- These were mistakenly dropped in 20260301222935 (treated as schema orphan,
-- but Prisma can't express generated columns so it was never in schema.prisma).
ALTER TABLE "Message" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("searchText", ''))) STORED;

CREATE INDEX "Message_searchVector_idx" ON "Message" USING GIN ("searchVector");
