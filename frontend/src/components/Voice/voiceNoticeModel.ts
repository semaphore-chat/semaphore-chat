import {
  VoiceEndReason,
  type VoiceJoinTarget,
  type VoiceState,
} from "../../contexts/VoiceContext";
import { VOICE_FAILURE_COPY } from "../../features/voice/joinFailure";
import { VOICE_END_DETAILS, VOICE_END_MESSAGES } from "../../features/voice/voiceEndReason";

/**
 * What the voice notice shows: the last failed join, or why the last call
 * ended. One notice at a time; the newer of the two wins.
 */
export interface VoiceNoticeModel {
  /** Stable per notice (for keys and tests). */
  id: string;
  severity: "error" | "warning" | "info";
  title: string;
  message: string;
  /** Retry joins this again; null = no Retry (trying again can't help). */
  retryTarget: VoiceJoinTarget | null;
}

const END_SEVERITY: Record<VoiceEndReason, VoiceNoticeModel["severity"]> = {
  [VoiceEndReason.DuplicateIdentity]: "info",
  [VoiceEndReason.ParticipantRemoved]: "warning",
  [VoiceEndReason.RoomDeleted]: "info",
  [VoiceEndReason.ReconnectFailed]: "error",
  [VoiceEndReason.AccessLost]: "warning",
  [VoiceEndReason.ChannelNotFound]: "warning",
  [VoiceEndReason.SessionExpired]: "warning",
};

export function describeVoiceNotice(
  state: Pick<VoiceState, "joinFailure" | "lastEnded">,
): VoiceNoticeModel | null {
  const { joinFailure, lastEnded } = state;
  if (joinFailure && (!lastEnded || joinFailure.at >= lastEnded.at)) {
    const copy = VOICE_FAILURE_COPY[joinFailure.kind];
    return {
      id: `join-failure:${joinFailure.kind}:${joinFailure.at}`,
      severity: "error",
      title: copy.title,
      message: copy.message,
      retryTarget: copy.retryable ? joinFailure.target : null,
    };
  }
  if (lastEnded) {
    return {
      id: `ended:${lastEnded.reason}:${lastEnded.at}`,
      severity: END_SEVERITY[lastEnded.reason],
      title: VOICE_END_MESSAGES[lastEnded.reason],
      message: VOICE_END_DETAILS[lastEnded.reason],
      retryTarget: lastEnded.reason === VoiceEndReason.ReconnectFailed ? lastEnded.target ?? null : null,
    };
  }
  return null;
}
