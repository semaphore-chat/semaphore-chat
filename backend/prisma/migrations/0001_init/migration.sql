-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RegistrationMode" AS ENUM ('OPEN', 'INVITE_ONLY', 'CLOSED');

-- CreateEnum
CREATE TYPE "FileType" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('USER_AVATAR', 'USER_BANNER', 'COMMUNITY_BANNER', 'COMMUNITY_AVATAR', 'MESSAGE_ATTACHMENT', 'CUSTOM_EMOJI', 'REPLAY_CLIP');

-- CreateEnum
CREATE TYPE "StorageType" AS ENUM ('LOCAL', 'S3', 'AZURE_BLOB');

-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('TEXT', 'VOICE');

-- CreateEnum
CREATE TYPE "RbacActions" AS ENUM ('DELETE_MESSAGE', 'DELETE_CHANNEL', 'DELETE_COMMUNITY', 'DELETE_INVITE', 'DELETE_USER', 'DELETE_ROLE', 'DELETE_ALIAS_GROUP', 'DELETE_ALIAS_GROUP_MEMBER', 'DELETE_INSTANCE_INVITE', 'DELETE_MEMBER', 'DELETE_REACTION', 'CREATE_MESSAGE', 'CREATE_CHANNEL', 'CREATE_COMMUNITY', 'CREATE_INVITE', 'CREATE_ROLE', 'CREATE_ALIAS_GROUP', 'CREATE_ALIAS_GROUP_MEMBER', 'CREATE_INSTANCE_INVITE', 'CREATE_MEMBER', 'CREATE_REACTION', 'JOIN_CHANNEL', 'READ_MESSAGE', 'READ_CHANNEL', 'READ_COMMUNITY', 'READ_ALL_COMMUNITIES', 'READ_USER', 'READ_ROLE', 'READ_ALIAS_GROUP', 'READ_ALIAS_GROUP_MEMBER', 'READ_INSTANCE_INVITE', 'READ_MEMBER', 'UPDATE_COMMUNITY', 'UPDATE_CHANNEL', 'UPDATE_USER', 'UPDATE_ROLE', 'UPDATE_ALIAS_GROUP', 'UPDATE_ALIAS_GROUP_MEMBER', 'UPDATE_INSTANCE_INVITE', 'UPDATE_MEMBER', 'CAPTURE_REPLAY', 'READ_INSTANCE_SETTINGS', 'UPDATE_INSTANCE_SETTINGS', 'READ_INSTANCE_STATS', 'MANAGE_USER_STORAGE', 'BAN_USER', 'KICK_USER', 'TIMEOUT_USER', 'UNBAN_USER', 'PIN_MESSAGE', 'UNPIN_MESSAGE', 'DELETE_ANY_MESSAGE', 'VIEW_BAN_LIST', 'VIEW_MODERATION_LOGS', 'MUTE_PARTICIPANT');

-- CreateEnum
CREATE TYPE "InstanceRole" AS ENUM ('OWNER', 'USER');

-- CreateEnum
CREATE TYPE "ModerationAction" AS ENUM ('BAN_USER', 'UNBAN_USER', 'KICK_USER', 'TIMEOUT_USER', 'REMOVE_TIMEOUT', 'DELETE_MESSAGE', 'PIN_MESSAGE', 'UNPIN_MESSAGE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('USER_MENTION', 'SPECIAL_MENTION', 'DIRECT_MESSAGE', 'CHANNEL_MESSAGE', 'THREAD_REPLY');

-- CreateEnum
CREATE TYPE "SpanType" AS ENUM ('PLAINTEXT', 'USER_MENTION', 'SPECIAL_MENTION', 'COMMUNITY_MENTION', 'ALIAS_MENTION');

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "channelId" TEXT,
    "directMessageGroupId" TEXT,
    "authorId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "pendingAttachments" INTEGER DEFAULT 0,
    "searchText" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "pinnedBy" TEXT,
    "deletedBy" TEXT,
    "deletedByReason" TEXT,
    "parentMessageId" TEXT,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "lastReplyAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageSpan" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "SpanType" NOT NULL,
    "text" TEXT,
    "userId" TEXT,
    "specialKind" TEXT,
    "communityId" TEXT,
    "aliasId" TEXT,

    CONSTRAINT "MessageSpan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreadSubscriber" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentMessageId" TEXT NOT NULL,
    "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThreadSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadReceipt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT,
    "directMessageGroupId" TEXT,
    "lastReadMessageId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "messageId" TEXT,
    "channelId" TEXT,
    "directMessageGroupId" TEXT,
    "authorId" TEXT NOT NULL,
    "parentMessageId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotificationSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "desktopEnabled" BOOLEAN NOT NULL DEFAULT true,
    "playSound" BOOLEAN NOT NULL DEFAULT true,
    "soundType" TEXT NOT NULL DEFAULT 'default',
    "doNotDisturb" BOOLEAN NOT NULL DEFAULT false,
    "dndStartTime" TEXT,
    "dndEndTime" TEXT,
    "defaultChannelLevel" TEXT NOT NULL DEFAULT 'mentions',
    "dmNotifications" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNotificationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAppearanceSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "themeMode" TEXT NOT NULL DEFAULT 'dark',
    "accentColor" TEXT NOT NULL DEFAULT 'blue',
    "intensity" TEXT NOT NULL DEFAULT 'minimal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAppearanceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelNotificationOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelNotificationOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "hashedPassword" TEXT NOT NULL,
    "role" "InstanceRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "avatarUrl" TEXT,
    "bannerUrl" TEXT,
    "lastSeen" TIMESTAMP(3),
    "displayName" TEXT,
    "bio" TEXT,
    "status" TEXT,
    "statusUpdatedAt" TIMESTAMP(3),
    "storageQuotaBytes" BIGINT NOT NULL DEFAULT 53687091200,
    "storageUsedBytes" BIGINT NOT NULL DEFAULT 0,
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "bannedAt" TIMESTAMP(3),
    "bannedById" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deviceName" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "familyId" TEXT,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstanceInvite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdById" TEXT,
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InstanceInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstanceInviteUsage" (
    "id" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstanceInviteUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstanceInviteDefaultCommunity" (
    "id" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,

    CONSTRAINT "InstanceInviteDefaultCommunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstanceSettings" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Kraken',
    "description" TEXT,
    "registrationMode" "RegistrationMode" NOT NULL DEFAULT 'INVITE_ONLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "defaultStorageQuotaBytes" BIGINT NOT NULL DEFAULT 53687091200,
    "maxFileSizeBytes" BIGINT NOT NULL DEFAULT 524288000,
    "vapidPublicKey" TEXT,
    "vapidPrivateKey" TEXT,
    "vapidSubject" TEXT,

    CONSTRAINT "InstanceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Community" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "avatar" TEXT,
    "banner" TEXT,
    "description" TEXT,

    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "ChannelType" NOT NULL DEFAULT 'TEXT',
    "position" INTEGER NOT NULL DEFAULT 0,
    "slowmodeSeconds" INTEGER NOT NULL DEFAULT 0,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelMembership" (
    "id" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "addedBy" TEXT,

    CONSTRAINT "ChannelMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AliasGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AliasGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AliasGroupMember" (
    "id" TEXT NOT NULL,
    "aliasGroupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AliasGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "communityId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "actions" "RbacActions"[] DEFAULT ARRAY[]::"RbacActions"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRoles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "communityId" TEXT,
    "roleId" TEXT NOT NULL,
    "isInstanceRole" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UserRoles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectMessageGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DirectMessageGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectMessageGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectMessageGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBlock" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileType" "FileType" NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "resourceType" "ResourceType" NOT NULL,
    "resourceId" TEXT,
    "storageType" "StorageType" NOT NULL DEFAULT 'LOCAL',
    "storagePath" TEXT NOT NULL,
    "thumbnailPath" TEXT,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EgressSession" (
    "id" TEXT NOT NULL,
    "egressId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "segmentPath" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EgressSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplayClip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "channelId" TEXT,
    "durationSeconds" INTEGER NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplayClip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityBan" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CommunityBan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityTimeout" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityTimeout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationLog" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetMessageId" TEXT,
    "action" "ModerationAction" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_channelId_sentAt_idx" ON "Message"("channelId", "sentAt");

-- CreateIndex
CREATE INDEX "Message_channelId_authorId_sentAt_idx" ON "Message"("channelId", "authorId", "sentAt");

-- CreateIndex
CREATE INDEX "Message_directMessageGroupId_sentAt_idx" ON "Message"("directMessageGroupId", "sentAt");

-- CreateIndex
CREATE INDEX "Message_channelId_pinned_idx" ON "Message"("channelId", "pinned");

-- CreateIndex
CREATE INDEX "Message_parentMessageId_idx" ON "Message"("parentMessageId");

-- CreateIndex
CREATE INDEX "Message_authorId_idx" ON "Message"("authorId");

-- CreateIndex
CREATE INDEX "MessageSpan_messageId_idx" ON "MessageSpan"("messageId");

-- CreateIndex
CREATE INDEX "MessageReaction_messageId_idx" ON "MessageReaction"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageReaction_messageId_emoji_userId_key" ON "MessageReaction"("messageId", "emoji", "userId");

-- CreateIndex
CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageAttachment_messageId_fileId_key" ON "MessageAttachment"("messageId", "fileId");

-- CreateIndex
CREATE INDEX "ThreadSubscriber_parentMessageId_idx" ON "ThreadSubscriber"("parentMessageId");

-- CreateIndex
CREATE INDEX "ThreadSubscriber_userId_idx" ON "ThreadSubscriber"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ThreadSubscriber_userId_parentMessageId_key" ON "ThreadSubscriber"("userId", "parentMessageId");

-- CreateIndex
CREATE INDEX "ReadReceipt_userId_channelId_idx" ON "ReadReceipt"("userId", "channelId");

-- CreateIndex
CREATE INDEX "ReadReceipt_userId_directMessageGroupId_idx" ON "ReadReceipt"("userId", "directMessageGroupId");

-- CreateIndex
CREATE INDEX "ReadReceipt_userId_idx" ON "ReadReceipt"("userId");

-- CreateIndex
CREATE INDEX "ReadReceipt_channelId_idx" ON "ReadReceipt"("channelId");

-- CreateIndex
CREATE INDEX "ReadReceipt_directMessageGroupId_idx" ON "ReadReceipt"("directMessageGroupId");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotificationSettings_userId_key" ON "UserNotificationSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAppearanceSettings_userId_key" ON "UserAppearanceSettings"("userId");

-- CreateIndex
CREATE INDEX "ChannelNotificationOverride_userId_idx" ON "ChannelNotificationOverride"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelNotificationOverride_userId_channelId_key" ON "ChannelNotificationOverride"("userId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_lastUsedAt_idx" ON "RefreshToken"("userId", "lastUsedAt");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "InstanceInvite_code_key" ON "InstanceInvite"("code");

-- CreateIndex
CREATE INDEX "InstanceInviteUsage_inviteId_idx" ON "InstanceInviteUsage"("inviteId");

-- CreateIndex
CREATE UNIQUE INDEX "InstanceInviteUsage_inviteId_userId_key" ON "InstanceInviteUsage"("inviteId", "userId");

-- CreateIndex
CREATE INDEX "InstanceInviteDefaultCommunity_inviteId_idx" ON "InstanceInviteDefaultCommunity"("inviteId");

-- CreateIndex
CREATE UNIQUE INDEX "InstanceInviteDefaultCommunity_inviteId_communityId_key" ON "InstanceInviteDefaultCommunity"("inviteId", "communityId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_communityId_key" ON "Membership"("userId", "communityId");

-- CreateIndex
CREATE UNIQUE INDEX "Community_name_key" ON "Community"("name");

-- CreateIndex
CREATE INDEX "Channel_communityId_type_position_idx" ON "Channel"("communityId", "type", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_communityId_name_key" ON "Channel"("communityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMembership_userId_channelId_key" ON "ChannelMembership"("userId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "AliasGroup_communityId_name_key" ON "AliasGroup"("communityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AliasGroupMember_aliasGroupId_userId_key" ON "AliasGroupMember"("aliasGroupId", "userId");

-- CreateIndex
CREATE INDEX "Role_name_communityId_idx" ON "Role"("name", "communityId");

-- CreateIndex
CREATE INDEX "UserRoles_userId_communityId_roleId_idx" ON "UserRoles"("userId", "communityId", "roleId");

-- CreateIndex
CREATE INDEX "DirectMessageGroupMember_userId_idx" ON "DirectMessageGroupMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DirectMessageGroupMember_groupId_userId_key" ON "DirectMessageGroupMember"("groupId", "userId");

-- CreateIndex
CREATE INDEX "Friendship_userBId_idx" ON "Friendship"("userBId");

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_userAId_userBId_key" ON "Friendship"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "UserBlock_blockerId_idx" ON "UserBlock"("blockerId");

-- CreateIndex
CREATE INDEX "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBlock_blockerId_blockedId_key" ON "UserBlock"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "File_uploadedById_idx" ON "File"("uploadedById");

-- CreateIndex
CREATE INDEX "File_deletedAt_idx" ON "File"("deletedAt");

-- CreateIndex
CREATE INDEX "File_resourceType_resourceId_idx" ON "File"("resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "EgressSession_egressId_key" ON "EgressSession"("egressId");

-- CreateIndex
CREATE INDEX "EgressSession_userId_status_idx" ON "EgressSession"("userId", "status");

-- CreateIndex
CREATE INDEX "EgressSession_status_createdAt_idx" ON "EgressSession"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReplayClip_userId_capturedAt_idx" ON "ReplayClip"("userId", "capturedAt");

-- CreateIndex
CREATE INDEX "CommunityBan_communityId_active_idx" ON "CommunityBan"("communityId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityBan_communityId_userId_key" ON "CommunityBan"("communityId", "userId");

-- CreateIndex
CREATE INDEX "CommunityTimeout_communityId_expiresAt_idx" ON "CommunityTimeout"("communityId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityTimeout_communityId_userId_key" ON "CommunityTimeout"("communityId", "userId");

-- CreateIndex
CREATE INDEX "ModerationLog_communityId_createdAt_idx" ON "ModerationLog"("communityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_directMessageGroupId_fkey" FOREIGN KEY ("directMessageGroupId") REFERENCES "DirectMessageGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "Message"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MessageSpan" ADD CONSTRAINT "MessageSpan_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadSubscriber" ADD CONSTRAINT "ThreadSubscriber_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadSubscriber" ADD CONSTRAINT "ThreadSubscriber_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadReceipt" ADD CONSTRAINT "ReadReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadReceipt" ADD CONSTRAINT "ReadReceipt_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadReceipt" ADD CONSTRAINT "ReadReceipt_directMessageGroupId_fkey" FOREIGN KEY ("directMessageGroupId") REFERENCES "DirectMessageGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotificationSettings" ADD CONSTRAINT "UserNotificationSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAppearanceSettings" ADD CONSTRAINT "UserAppearanceSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelNotificationOverride" ADD CONSTRAINT "ChannelNotificationOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelNotificationOverride" ADD CONSTRAINT "ChannelNotificationOverride_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_bannedById_fkey" FOREIGN KEY ("bannedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstanceInvite" ADD CONSTRAINT "InstanceInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstanceInviteUsage" ADD CONSTRAINT "InstanceInviteUsage_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "InstanceInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstanceInviteDefaultCommunity" ADD CONSTRAINT "InstanceInviteDefaultCommunity_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "InstanceInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstanceInviteDefaultCommunity" ADD CONSTRAINT "InstanceInviteDefaultCommunity_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMembership" ADD CONSTRAINT "ChannelMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMembership" ADD CONSTRAINT "ChannelMembership_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AliasGroupMember" ADD CONSTRAINT "AliasGroupMember_aliasGroupId_fkey" FOREIGN KEY ("aliasGroupId") REFERENCES "AliasGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AliasGroupMember" ADD CONSTRAINT "AliasGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoles" ADD CONSTRAINT "UserRoles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoles" ADD CONSTRAINT "UserRoles_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoles" ADD CONSTRAINT "UserRoles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectMessageGroupMember" ADD CONSTRAINT "DirectMessageGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DirectMessageGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectMessageGroupMember" ADD CONSTRAINT "DirectMessageGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EgressSession" ADD CONSTRAINT "EgressSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayClip" ADD CONSTRAINT "ReplayClip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayClip" ADD CONSTRAINT "ReplayClip_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityBan" ADD CONSTRAINT "CommunityBan_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityTimeout" ADD CONSTRAINT "CommunityTimeout_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationLog" ADD CONSTRAINT "ModerationLog_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Custom: add tsvector generated column + GIN index for full-text search
-- (Prisma cannot express generated columns natively)
ALTER TABLE "Message" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("searchText", ''))) STORED;
CREATE INDEX "Message_searchVector_idx" ON "Message" USING GIN ("searchVector");

