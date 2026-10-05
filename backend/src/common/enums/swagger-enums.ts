/**
 * Const arrays mirroring Prisma enums for use with @ApiProperty({ enum: ... }).
 *
 * The NestJS Swagger plugin can't introspect Prisma enum types, so we provide
 * these arrays as the enum metadata source for OpenAPI spec generation.
 *
 * Keep these in sync with the enum definitions in prisma/schema.prisma.
 */

export const SpanTypeValues = [
  'PLAINTEXT',
  'USER_MENTION',
  'SPECIAL_MENTION',
  'COMMUNITY_MENTION',
  'ALIAS_MENTION',
  'CHANNEL_MENTION',
  'CODE_BLOCK',
  'EMOJI',
] as const;

export const FileTypeValues = [
  'IMAGE',
  'VIDEO',
  'AUDIO',
  'DOCUMENT',
  'OTHER',
] as const;

export const ResourceTypeValues = [
  'USER_AVATAR',
  'USER_BANNER',
  'COMMUNITY_BANNER',
  'COMMUNITY_AVATAR',
  'MESSAGE_ATTACHMENT',
  'CUSTOM_EMOJI',
  'REPLAY_CLIP',
  'SOUNDBOARD_SOUND',
] as const;

export const StorageTypeValues = ['LOCAL', 'S3', 'AZURE_BLOB'] as const;

export const FriendshipStatusValues = [
  'PENDING',
  'ACCEPTED',
  'BLOCKED',
] as const;

export const ChannelTypeValues = ['TEXT', 'VOICE'] as const;

export const RbacActionsValues = [
  'DELETE_MESSAGE',
  'DELETE_CHANNEL',
  'DELETE_COMMUNITY',
  'DELETE_INVITE',
  'DELETE_USER',
  'DELETE_ROLE',
  'DELETE_ALIAS_GROUP',
  'DELETE_ALIAS_GROUP_MEMBER',
  'DELETE_INSTANCE_INVITE',
  'DELETE_MEMBER',
  'DELETE_REACTION',
  'CREATE_MESSAGE',
  'CREATE_CHANNEL',
  'CREATE_COMMUNITY',
  'CREATE_INVITE',

  'CREATE_ROLE',
  'CREATE_ALIAS_GROUP',
  'CREATE_ALIAS_GROUP_MEMBER',
  'CREATE_INSTANCE_INVITE',
  'CREATE_MEMBER',
  'CREATE_REACTION',
  'JOIN_CHANNEL',
  'READ_MESSAGE',
  'READ_CHANNEL',
  'READ_COMMUNITY',
  'READ_ALL_COMMUNITIES',
  'READ_USER',
  'READ_ROLE',
  'READ_ALIAS_GROUP',
  'READ_ALIAS_GROUP_MEMBER',
  'READ_INSTANCE_INVITE',
  'READ_MEMBER',
  'UPDATE_COMMUNITY',
  'UPDATE_CHANNEL',

  'UPDATE_USER',
  'UPDATE_ROLE',
  'UPDATE_ALIAS_GROUP',
  'UPDATE_ALIAS_GROUP_MEMBER',
  'UPDATE_INSTANCE_INVITE',
  'UPDATE_MEMBER',
  'CAPTURE_REPLAY',
  'READ_INSTANCE_SETTINGS',
  'UPDATE_INSTANCE_SETTINGS',
  'READ_INSTANCE_STATS',
  'MANAGE_USER_STORAGE',
  'BAN_USER',
  'KICK_USER',
  'TIMEOUT_USER',
  'UNBAN_USER',
  'PIN_MESSAGE',
  'UNPIN_MESSAGE',
  'DELETE_ANY_MESSAGE',
  'VIEW_BAN_LIST',
  'VIEW_MODERATION_LOGS',
  'MUTE_PARTICIPANT',
  'MANAGE_EMOJIS',
  'CREATE_SOUNDBOARD_SOUND',
  'DELETE_SOUNDBOARD_SOUND',
  'READ_SOUNDBOARD_SOUND',
  'ATTACH_FILES',
  'SPEAK',
  'VIDEO',
  'SCREEN_SHARE',
  'MANAGE_CHANNEL_PERMISSIONS',
  'MANAGE_WEBHOOKS',
] as const;

export const OverwriteTargetValues = ['EVERYONE', 'ROLE', 'MEMBER'] as const;

export const ChannelPresetValues = [
  'NORMAL',
  'READ_ONLY',
  'ANNOUNCEMENT',
  'MODS_ONLY',
  'CUSTOM',
] as const;

export const InstanceRoleValues = ['OWNER', 'USER'] as const;

export const ModerationActionValues = [
  'BAN_USER',
  'UNBAN_USER',
  'KICK_USER',
  'TIMEOUT_USER',
  'REMOVE_TIMEOUT',
  'DELETE_MESSAGE',
  'PIN_MESSAGE',
  'UNPIN_MESSAGE',
] as const;

export const NotificationTypeValues = [
  'USER_MENTION',
  'SPECIAL_MENTION',
  'DIRECT_MESSAGE',
  'CHANNEL_MESSAGE',
  'THREAD_REPLY',
] as const;

export const RegistrationModeValues = [
  'OPEN',
  'INVITE_ONLY',
  'CLOSED',
] as const;
