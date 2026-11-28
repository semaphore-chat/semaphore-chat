/**
 * What a conversation is about: a community's text channel or a direct-message group. The Lounge's chat data hooks
 * (`useConversation`, `useChannelChat`, `useChannelComposer`) take one, so the DM screen runs on the same model as
 * the channel screen. The hooks underneath keep their own channel/DM options (`useReadMarks`, `useTypingUsers`,
 * `useJumpToMessage`...), so the cache keys and socket events are the classic shell's, shared with it.
 */
import { VoiceSessionType } from '../../contexts/VoiceContext';

export type ChatTarget =
  | { kind: 'channel'; channelId: string; communityId: string }
  | { kind: 'dm'; dmGroupId: string };

/**
 * The hooks' target argument: a `target`, or the channel-only `communityId` + `channelId` they took before DMs (kept
 * so existing callers need no change).
 */
export type ChatTargetArgs =
  | { target: ChatTarget; communityId?: never; channelId?: never }
  | { target?: never; communityId: string; channelId: string };

export function resolveChatTarget(args: ChatTargetArgs): ChatTarget {
  return args.target ?? { kind: 'channel', channelId: args.channelId, communityId: args.communityId };
}

/** The channel id or the DM group id: the conversation's identity (the read-receipt and reset key). */
export function chatTargetId(target: ChatTarget): string {
  return target.kind === 'channel' ? target.channelId : target.dmGroupId;
}

/** The `channelId` / `directMessageGroupId` pair the shared hooks take (one of them set). */
export function chatTargetIds(target: ChatTarget): { channelId?: string; directMessageGroupId?: string } {
  return target.kind === 'channel' ? { channelId: target.channelId } : { directMessageGroupId: target.dmGroupId };
}

/** The `contextType` / `contextId` pair (notifications, availability, the send). */
export function chatTargetContext(target: ChatTarget): { contextType: VoiceSessionType; contextId: string } {
  return target.kind === 'channel'
    ? { contextType: VoiceSessionType.Channel, contextId: target.channelId }
    : { contextType: VoiceSessionType.Dm, contextId: target.dmGroupId };
}
