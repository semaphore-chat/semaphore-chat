-- New RbacActions for channel permission overwrites (phase 1).
-- In their own migration: PostgreSQL can't use an enum value in the same
-- transaction that adds it, and the next migration backfills roles with them.
ALTER TYPE "RbacActions" ADD VALUE 'ATTACH_FILES';
ALTER TYPE "RbacActions" ADD VALUE 'SPEAK';
ALTER TYPE "RbacActions" ADD VALUE 'VIDEO';
ALTER TYPE "RbacActions" ADD VALUE 'SCREEN_SHARE';
ALTER TYPE "RbacActions" ADD VALUE 'MANAGE_CHANNEL_PERMISSIONS';
ALTER TYPE "RbacActions" ADD VALUE 'MANAGE_WEBHOOKS';
