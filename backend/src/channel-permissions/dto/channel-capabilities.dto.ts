import { ApiProperty } from '@nestjs/swagger';

/**
 * What the current user can do in one channel. The frontend decides
 * visibility and every capability from this alone.
 */
export class ChannelCapabilitiesDto {
  channelId: string;
  /** Can see the channel at all (name, messages). */
  view: boolean;
  /** Send messages. */
  post: boolean;
  /** Attach files to messages. */
  attach: boolean;
  /** Add reactions. */
  react: boolean;
  /** Reply in threads. */
  threadReply: boolean;
  /** Connect to voice and listen (kept during a timeout). */
  connect: boolean;
  /** Publish the microphone. */
  speak: boolean;
  /** Publish the camera. */
  video: boolean;
  /** Share the screen. */
  share: boolean;
  /** Edit this channel's permission overwrites. */
  managePermissions: boolean;
  /** End of the user's community timeout, if one is active. */
  @ApiProperty({ type: Date, nullable: true })
  timedOutUntil: Date | null;
  /**
   * Roles whose holders can post here, by rank (names only), for the
   * read-only notice. Empty for a channel the user can't view.
   */
  @ApiProperty({ type: [String] })
  postingRoleNames: string[];
}

export class CommunityChannelCapabilitiesDto {
  communityId: string;
  /** Only the channels the user can see. */
  @ApiProperty({ type: [ChannelCapabilitiesDto] })
  channels: ChannelCapabilitiesDto[];
}
