-- CREATE INDEX CONCURRENTLY cannot run inside a transaction, so this migration
-- must stay a single statement: Prisma runs a script with more than one
-- statement in one transaction, which would fail here. If the build is
-- interrupted or fails, it leaves an INVALID index behind and Prisma records
-- the migration as failed, which blocks later deploys. Drop that index, tell
-- Prisma the migration is rolled back, then deploy again:
--   DROP INDEX CONCURRENTLY IF EXISTS "Message_authorId_clientNonce_key";
--   pnpm exec prisma migrate resolve --rolled-back 20261105200100_message_client_nonce_index
--   pnpm run prisma:migrate
CREATE UNIQUE INDEX CONCURRENTLY "Message_authorId_clientNonce_key" ON "Message"("authorId", "clientNonce");
