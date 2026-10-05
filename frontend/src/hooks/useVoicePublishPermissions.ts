/**
 * What the current user may publish in the voice call they're connected to,
 * plus the tooltip to show on a control they can't use. Channel calls read
 * useChannelPermissions (speak / video / share, which a community timeout
 * removes while keeping listen); DM calls are never restricted.
 *
 * The LiveKit token carries the same limits, so this is about making the
 * controls honest, not about enforcement.
 */
import { useVoice, VoiceSessionType } from "../contexts/VoiceContext";
import { formatClockTime } from "../utils/messageTime";
import { useChannelPermissions } from "./useChannelPermissions";

export interface VoicePublishPermissions {
  canSpeak: boolean;
  canVideo: boolean;
  canShare: boolean;
  /** Tooltip for a disabled mic / camera / share button. */
  speakBlockedReason: string;
  videoBlockedReason: string;
  shareBlockedReason: string;
}

export function useVoicePublishPermissions(): VoicePublishPermissions {
  const voice = useVoice();
  const isChannel = voice.contextType === VoiceSessionType.Channel;
  const { can, timedOutUntil } = useChannelPermissions(
    isChannel ? voice.communityId ?? undefined : undefined,
    isChannel ? voice.currentChannelId ?? undefined : undefined,
  );

  const timedOut = isChannel && !!timedOutUntil;
  const timeoutReason = timedOutUntil
    ? `Timed out — you can listen until ${formatClockTime(timedOutUntil)}`
    : "";

  return {
    canSpeak: !isChannel || can("speak"),
    canVideo: !isChannel || can("video"),
    canShare: !isChannel || can("share"),
    speakBlockedReason: timedOut ? timeoutReason : "You can't speak in this channel",
    videoBlockedReason: timedOut ? timeoutReason : "You can't use video in this channel",
    shareBlockedReason: timedOut ? timeoutReason : "You can't share your screen in this channel",
  };
}
