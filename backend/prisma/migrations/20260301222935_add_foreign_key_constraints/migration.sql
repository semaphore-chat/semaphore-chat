-- ============================================================================
-- Migration: Add Foreign Key Constraints to All Unenforced Entity References
-- ============================================================================

-- ============================================================================
-- STEP 1: Add new columns, make fields nullable
-- ============================================================================

-- Add typed FK columns to File (replacing polymorphic resourceId)
ALTER TABLE "File" ADD COLUMN "fileUserId" TEXT;
ALTER TABLE "File" ADD COLUMN "fileCommunityId" TEXT;
ALTER TABLE "File" ADD COLUMN "fileMessageId" TEXT;

-- Make fields nullable where needed
ALTER TABLE "Message" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "CommunityBan" ALTER COLUMN "moderatorId" DROP NOT NULL;
ALTER TABLE "CommunityTimeout" ALTER COLUMN "moderatorId" DROP NOT NULL;
ALTER TABLE "ModerationLog" ALTER COLUMN "moderatorId" DROP NOT NULL;

-- Drop searchVector column and index (leftover from previous migration, not in schema)
DROP INDEX IF EXISTS "Message_searchVector_idx";
ALTER TABLE "Message" DROP COLUMN IF EXISTS "searchVector";

-- ============================================================================
-- STEP 2: Data migration — populate typed FK columns from resourceId
-- ============================================================================

UPDATE "File" SET "fileUserId" = "resourceId"
  WHERE "resourceType" IN ('USER_AVATAR', 'USER_BANNER', 'REPLAY_CLIP')
    AND "resourceId" IS NOT NULL;

UPDATE "File" SET "fileCommunityId" = "resourceId"
  WHERE "resourceType" IN ('COMMUNITY_AVATAR', 'COMMUNITY_BANNER', 'CUSTOM_EMOJI')
    AND "resourceId" IS NOT NULL;

UPDATE "File" SET "fileMessageId" = "resourceId"
  WHERE "resourceType" = 'MESSAGE_ATTACHMENT'
    AND "resourceId" IS NOT NULL;

-- ============================================================================
-- STEP 3: Orphan cleanup — fix dangling references before adding FK constraints
-- ============================================================================

-- SetNull relations: NULL out references to non-existent targets
UPDATE "Message" SET "authorId" = NULL
  WHERE "authorId" IS NOT NULL AND "authorId" NOT IN (SELECT "id" FROM "User");
UPDATE "Message" SET "pinnedBy" = NULL
  WHERE "pinnedBy" IS NOT NULL AND "pinnedBy" NOT IN (SELECT "id" FROM "User");
UPDATE "Message" SET "deletedBy" = NULL
  WHERE "deletedBy" IS NOT NULL AND "deletedBy" NOT IN (SELECT "id" FROM "User");
UPDATE "MessageSpan" SET "userId" = NULL
  WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT "id" FROM "User");
UPDATE "MessageSpan" SET "communityId" = NULL
  WHERE "communityId" IS NOT NULL AND "communityId" NOT IN (SELECT "id" FROM "Community");
UPDATE "MessageSpan" SET "aliasId" = NULL
  WHERE "aliasId" IS NOT NULL AND "aliasId" NOT IN (SELECT "id" FROM "AliasGroup");
UPDATE "ChannelMembership" SET "addedBy" = NULL
  WHERE "addedBy" IS NOT NULL AND "addedBy" NOT IN (SELECT "id" FROM "User");
UPDATE "ModerationLog" SET "moderatorId" = NULL
  WHERE "moderatorId" IS NOT NULL AND "moderatorId" NOT IN (SELECT "id" FROM "User");
UPDATE "ModerationLog" SET "targetUserId" = NULL
  WHERE "targetUserId" IS NOT NULL AND "targetUserId" NOT IN (SELECT "id" FROM "User");
UPDATE "ModerationLog" SET "targetMessageId" = NULL
  WHERE "targetMessageId" IS NOT NULL AND "targetMessageId" NOT IN (SELECT "id" FROM "Message");
UPDATE "Notification" SET "parentMessageId" = NULL
  WHERE "parentMessageId" IS NOT NULL AND "parentMessageId" NOT IN (SELECT "id" FROM "Message");
UPDATE "CommunityBan" SET "moderatorId" = NULL
  WHERE "moderatorId" IS NOT NULL AND "moderatorId" NOT IN (SELECT "id" FROM "User");
UPDATE "CommunityTimeout" SET "moderatorId" = NULL
  WHERE "moderatorId" IS NOT NULL AND "moderatorId" NOT IN (SELECT "id" FROM "User");
UPDATE "ReplayClip" SET "channelId" = NULL
  WHERE "channelId" IS NOT NULL AND "channelId" NOT IN (SELECT "id" FROM "Channel");
UPDATE "User" SET "avatarUrl" = NULL
  WHERE "avatarUrl" IS NOT NULL AND "avatarUrl" NOT IN (SELECT "id" FROM "File");
UPDATE "User" SET "bannerUrl" = NULL
  WHERE "bannerUrl" IS NOT NULL AND "bannerUrl" NOT IN (SELECT "id" FROM "File");
UPDATE "Community" SET "avatar" = NULL
  WHERE "avatar" IS NOT NULL AND "avatar" NOT IN (SELECT "id" FROM "File");
UPDATE "Community" SET "banner" = NULL
  WHERE "banner" IS NOT NULL AND "banner" NOT IN (SELECT "id" FROM "File");

-- Cascade relations: DELETE records with non-existent targets
DELETE FROM "MessageReaction"
  WHERE "userId" NOT IN (SELECT "id" FROM "User");
DELETE FROM "ReadReceipt"
  WHERE "lastReadMessageId" NOT IN (SELECT "id" FROM "Message");
DELETE FROM "Notification"
  WHERE "directMessageGroupId" IS NOT NULL
    AND "directMessageGroupId" NOT IN (SELECT "id" FROM "DirectMessageGroup");
DELETE FROM "CommunityBan"
  WHERE "userId" NOT IN (SELECT "id" FROM "User");
DELETE FROM "CommunityTimeout"
  WHERE "userId" NOT IN (SELECT "id" FROM "User");
DELETE FROM "InstanceInviteUsage"
  WHERE "userId" NOT IN (SELECT "id" FROM "User");
DELETE FROM "EgressSession"
  WHERE "channelId" NOT IN (SELECT "id" FROM "Channel");

-- Delete orphaned File records (rather than nulling FKs, which would make files publicly accessible)
DELETE FROM "File"
  WHERE "fileUserId" IS NOT NULL AND "fileUserId" NOT IN (SELECT "id" FROM "User");
DELETE FROM "File"
  WHERE "fileCommunityId" IS NOT NULL AND "fileCommunityId" NOT IN (SELECT "id" FROM "Community");
DELETE FROM "File"
  WHERE "fileMessageId" IS NOT NULL AND "fileMessageId" NOT IN (SELECT "id" FROM "Message");

-- Clean AliasGroup orphans (needs FK to Community)
DELETE FROM "AliasGroup"
  WHERE "communityId" NOT IN (SELECT "id" FROM "Community");

-- ============================================================================
-- STEP 4: Add FK constraints
-- ============================================================================

-- Message → User (SetNull)
ALTER TABLE "Message" ADD CONSTRAINT "Message_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_pinnedBy_fkey"
  FOREIGN KEY ("pinnedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_deletedBy_fkey"
  FOREIGN KEY ("deletedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- MessageSpan → User/Community/AliasGroup (SetNull)
ALTER TABLE "MessageSpan" ADD CONSTRAINT "MessageSpan_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MessageSpan" ADD CONSTRAINT "MessageSpan_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MessageSpan" ADD CONSTRAINT "MessageSpan_aliasId_fkey"
  FOREIGN KEY ("aliasId") REFERENCES "AliasGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- MessageReaction → User (Cascade)
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ReadReceipt → Message (Cascade)
ALTER TABLE "ReadReceipt" ADD CONSTRAINT "ReadReceipt_lastReadMessageId_fkey"
  FOREIGN KEY ("lastReadMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Notification → Message (SetNull), DirectMessageGroup (Cascade)
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_parentMessageId_fkey"
  FOREIGN KEY ("parentMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_directMessageGroupId_fkey"
  FOREIGN KEY ("directMessageGroupId") REFERENCES "DirectMessageGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ChannelMembership → User (SetNull)
ALTER TABLE "ChannelMembership" ADD CONSTRAINT "ChannelMembership_addedBy_fkey"
  FOREIGN KEY ("addedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AliasGroup → Community (Cascade)
ALTER TABLE "AliasGroup" ADD CONSTRAINT "AliasGroup_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- User → File (SetNull) for avatar/banner
ALTER TABLE "User" ADD CONSTRAINT "User_avatarUrl_fkey"
  FOREIGN KEY ("avatarUrl") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_bannerUrl_fkey"
  FOREIGN KEY ("bannerUrl") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Community → File (SetNull) for avatar/banner
ALTER TABLE "Community" ADD CONSTRAINT "Community_avatar_fkey"
  FOREIGN KEY ("avatar") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Community" ADD CONSTRAINT "Community_banner_fkey"
  FOREIGN KEY ("banner") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- File → User/Community/Message (Cascade) typed FK columns
ALTER TABLE "File" ADD CONSTRAINT "File_fileUserId_fkey"
  FOREIGN KEY ("fileUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "File" ADD CONSTRAINT "File_fileCommunityId_fkey"
  FOREIGN KEY ("fileCommunityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "File" ADD CONSTRAINT "File_fileMessageId_fkey"
  FOREIGN KEY ("fileMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EgressSession → Channel (Cascade)
ALTER TABLE "EgressSession" ADD CONSTRAINT "EgressSession_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ReplayClip → Channel (SetNull)
ALTER TABLE "ReplayClip" ADD CONSTRAINT "ReplayClip_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CommunityBan → User (Cascade for banned user, SetNull for moderator)
ALTER TABLE "CommunityBan" ADD CONSTRAINT "CommunityBan_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityBan" ADD CONSTRAINT "CommunityBan_moderatorId_fkey"
  FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CommunityTimeout → User (Cascade for timed out user, SetNull for moderator)
ALTER TABLE "CommunityTimeout" ADD CONSTRAINT "CommunityTimeout_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityTimeout" ADD CONSTRAINT "CommunityTimeout_moderatorId_fkey"
  FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ModerationLog → User/Message (SetNull)
ALTER TABLE "ModerationLog" ADD CONSTRAINT "ModerationLog_moderatorId_fkey"
  FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationLog" ADD CONSTRAINT "ModerationLog_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationLog" ADD CONSTRAINT "ModerationLog_targetMessageId_fkey"
  FOREIGN KEY ("targetMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- InstanceInviteUsage → User (Cascade)
ALTER TABLE "InstanceInviteUsage" ADD CONSTRAINT "InstanceInviteUsage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- STEP 5: Drop resourceId column and old composite index
-- ============================================================================

DROP INDEX IF EXISTS "File_resourceType_resourceId_idx";
ALTER TABLE "File" DROP COLUMN "resourceId";

-- ============================================================================
-- STEP 6: Add new indexes on typed FK columns
-- ============================================================================

CREATE INDEX "File_fileUserId_idx" ON "File"("fileUserId");
CREATE INDEX "File_fileCommunityId_idx" ON "File"("fileCommunityId");
CREATE INDEX "File_fileMessageId_idx" ON "File"("fileMessageId");

-- ============================================================================
-- STEP 7: Add CHECK constraint on File (at most one typed FK is non-null)
-- ============================================================================

ALTER TABLE "File" ADD CONSTRAINT "File_single_resource_fk"
  CHECK (num_nonnulls("fileUserId", "fileCommunityId", "fileMessageId") <= 1);
