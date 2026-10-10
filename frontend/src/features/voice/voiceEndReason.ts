import { VoiceEndReason } from '../../contexts/VoiceContext';

/** User-facing text for why a call ended without the user hanging up. */
export const VOICE_END_MESSAGES: Record<VoiceEndReason, string> = {
  [VoiceEndReason.DuplicateIdentity]: 'You joined from another device',
  [VoiceEndReason.ParticipantRemoved]: 'You were removed from the voice channel',
  [VoiceEndReason.RoomDeleted]: 'The voice channel was closed',
  [VoiceEndReason.ReconnectFailed]: 'Lost connection to voice and could not reconnect',
  [VoiceEndReason.AccessLost]: 'You no longer have access to this voice channel',
  [VoiceEndReason.ChannelNotFound]: 'This voice channel no longer exists',
  [VoiceEndReason.SessionExpired]: 'Your session has ended. Sign in again to rejoin voice',
};

export function describeVoiceEnd(reason: VoiceEndReason): string {
  return VOICE_END_MESSAGES[reason];
}

/**
 * HTTP status of an error from the generated API client, which throws the
 * parsed NestJS error body (`{ statusCode, message, error }`). Only that
 * body counts: a LiveKit `ConnectionError` also carries a `status` (its
 * validate endpoint's 401/403/404, e.g. clock skew or an API-key mismatch),
 * and those stay retryable.
 */
function httpStatusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object' || error instanceof Error) return null;
  const { statusCode } = error as { statusCode?: unknown };
  return typeof statusCode === 'number' ? statusCode : null;
}

/**
 * A rejoin failure that retrying can't fix, as the reason to end the call
 * with; null for errors worth retrying (network, timeout, 5xx).
 *
 * A 401 only reaches here after the client's interceptor tried to refresh
 * the session and the server refused it (an unavailable refresh becomes a
 * retryable 503), so it means the session is gone.
 */
export function definitiveRejoinFailure(error: unknown): VoiceEndReason | null {
  switch (httpStatusOf(error)) {
    case 401:
      return VoiceEndReason.SessionExpired;
    case 403:
      return VoiceEndReason.AccessLost;
    case 404:
      return VoiceEndReason.ChannelNotFound;
    default:
      return null;
  }
}

/** A readable message from an API or JS error, for VoiceEnded.error. */
export function errorMessageOf(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const { message } = error as { message?: unknown };
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(', ');
  }
  return null;
}
