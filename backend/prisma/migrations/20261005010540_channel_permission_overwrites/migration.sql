-- CreateEnum
CREATE TYPE "OverwriteTarget" AS ENUM ('EVERYONE', 'ROLE', 'MEMBER');

-- CreateEnum
CREATE TYPE "ChannelPreset" AS ENUM ('NORMAL', 'READ_ONLY', 'ANNOUNCEMENT', 'MODS_ONLY', 'CUSTOM');

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "preset" "ChannelPreset" NOT NULL DEFAULT 'NORMAL';

-- CreateTable
CREATE TABLE "ChannelPermissionOverwrite" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "targetType" "OverwriteTarget" NOT NULL,
    "roleId" TEXT,
    "userId" TEXT,
    "allow" "RbacActions"[] DEFAULT ARRAY[]::"RbacActions"[],
    "deny" "RbacActions"[] DEFAULT ARRAY[]::"RbacActions"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelPermissionOverwrite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelPermissionOverwrite_channelId_idx" ON "ChannelPermissionOverwrite"("channelId");

-- CreateIndex
CREATE INDEX "ChannelPermissionOverwrite_roleId_idx" ON "ChannelPermissionOverwrite"("roleId");

-- CreateIndex
CREATE INDEX "ChannelPermissionOverwrite_userId_idx" ON "ChannelPermissionOverwrite"("userId");

-- AddForeignKey
ALTER TABLE "ChannelPermissionOverwrite" ADD CONSTRAINT "ChannelPermissionOverwrite_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelPermissionOverwrite" ADD CONSTRAINT "ChannelPermissionOverwrite_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelPermissionOverwrite" ADD CONSTRAINT "ChannelPermissionOverwrite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: one overwrite per target, target columns match the type,
-- and no action is both allowed and denied.
CREATE UNIQUE INDEX "ChannelPermissionOverwrite_everyone_key"
  ON "ChannelPermissionOverwrite"("channelId") WHERE "targetType" = 'EVERYONE';
CREATE UNIQUE INDEX "ChannelPermissionOverwrite_role_key"
  ON "ChannelPermissionOverwrite"("channelId", "roleId") WHERE "targetType" = 'ROLE';
CREATE UNIQUE INDEX "ChannelPermissionOverwrite_member_key"
  ON "ChannelPermissionOverwrite"("channelId", "userId") WHERE "targetType" = 'MEMBER';

ALTER TABLE "ChannelPermissionOverwrite" ADD CONSTRAINT "ChannelPermissionOverwrite_target_check" CHECK (
  ("targetType" = 'EVERYONE' AND "roleId" IS NULL AND "userId" IS NULL) OR
  ("targetType" = 'ROLE' AND "roleId" IS NOT NULL AND "userId" IS NULL) OR
  ("targetType" = 'MEMBER' AND "userId" IS NOT NULL AND "roleId" IS NULL)
);

ALTER TABLE "ChannelPermissionOverwrite" ADD CONSTRAINT "ChannelPermissionOverwrite_allow_deny_disjoint"
  CHECK (NOT ("allow" && "deny"));

-- Backfill: nobody loses an ability they have today.
-- Attaching files was implied by sending messages.
UPDATE "Role" SET "actions" = array_append("actions", 'ATTACH_FILES')
  WHERE 'CREATE_MESSAGE' = ANY("actions") AND NOT ('ATTACH_FILES' = ANY("actions"));
-- Speaking, video and screen share were implied by joining voice.
UPDATE "Role" SET "actions" = array_append("actions", 'SPEAK')
  WHERE 'JOIN_CHANNEL' = ANY("actions") AND NOT ('SPEAK' = ANY("actions"));
UPDATE "Role" SET "actions" = array_append("actions", 'VIDEO')
  WHERE 'JOIN_CHANNEL' = ANY("actions") AND NOT ('VIDEO' = ANY("actions"));
UPDATE "Role" SET "actions" = array_append("actions", 'SCREEN_SHARE')
  WHERE 'JOIN_CHANNEL' = ANY("actions") AND NOT ('SCREEN_SHARE' = ANY("actions"));
-- Editing a channel (including its privacy) is today's equivalent of
-- managing its permissions, and it is what gated webhook management.
UPDATE "Role" SET "actions" = array_append("actions", 'MANAGE_CHANNEL_PERMISSIONS')
  WHERE 'UPDATE_CHANNEL' = ANY("actions") AND NOT ('MANAGE_CHANNEL_PERMISSIONS' = ANY("actions"));
UPDATE "Role" SET "actions" = array_append("actions", 'MANAGE_WEBHOOKS')
  WHERE 'UPDATE_CHANNEL' = ANY("actions") AND NOT ('MANAGE_WEBHOOKS' = ANY("actions"));
