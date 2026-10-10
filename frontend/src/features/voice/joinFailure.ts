import { VoiceFailureKind } from '../../contexts/VoiceContext';
import { CONNECTION_ERROR_REASON } from './livekitEvents';

/**
 * Classifies a failed voice join, and the copy the voice notice shows for it.
 *
 * No livekit-client runtime import: VoiceNotice is rendered by the
 * always-mounted VoiceBottomBar shell (see livekitEvents.ts).
 */

export interface VoiceFailureCopy {
  title: string;
  message: string;
  /** Whether trying again can help (Retry button). */
  retryable: boolean;
}

export const VOICE_FAILURE_COPY: Record<VoiceFailureKind, VoiceFailureCopy> = {
  [VoiceFailureKind.MediaUnreachable]: {
    title: "Can't connect to voice",
    message:
      "Can't reach the voice server's media ports. Your network may be blocking UDP: try another network, or ask your admin to check the TURN fallback.",
    retryable: true,
  },
  [VoiceFailureKind.ServerUnreachable]: {
    title: "Can't reach the voice server",
    message:
      "Check your internet connection. If it's working, the voice server may be down or blocked: ask your admin.",
    retryable: true,
  },
  [VoiceFailureKind.Permission]: {
    title: "You can't join this voice channel",
    message: "You don't have permission to connect here. Ask a moderator if you think you should.",
    retryable: false,
  },
  [VoiceFailureKind.NotFound]: {
    title: 'Voice channel not found',
    message: 'It may have been deleted.',
    retryable: false,
  },
  [VoiceFailureKind.Session]: {
    title: 'Your session has ended',
    message: 'Sign in again to join voice.',
    retryable: false,
  },
  [VoiceFailureKind.ServerError]: {
    title: 'Voice server error',
    message: 'Something went wrong on the server. Try again in a moment.',
    retryable: true,
  },
  [VoiceFailureKind.Unknown]: {
    title: "Couldn't join voice",
    message: 'Something went wrong while connecting.',
    retryable: true,
  },
};

interface LivekitConnectionErrorLike {
  name: 'ConnectionError';
  reason: number;
  status?: number;
  message: string;
}

function isLivekitConnectionError(error: unknown): error is LivekitConnectionErrorLike {
  return (
    error instanceof Error &&
    error.name === 'ConnectionError' &&
    typeof (error as { reason?: unknown }).reason === 'number'
  );
}

/** The API client throws the parsed NestJS error body: `{ statusCode, message, error }`. */
function apiStatusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object' || error instanceof Error) return null;
  const { statusCode } = error as { statusCode?: unknown };
  return typeof statusCode === 'number' ? statusCode : null;
}

function classifyLivekit(error: LivekitConnectionErrorLike): VoiceFailureKind | null {
  switch (error.reason) {
    case CONNECTION_ERROR_REASON.Cancelled:
      return null; // a hang-up while connecting, not a failure
    case CONNECTION_ERROR_REASON.NotAllowed:
      // The validate endpoint refused the token (no CONNECT, revoked access).
      return error.status === 404 ? VoiceFailureKind.NotFound : VoiceFailureKind.Permission;
    case CONNECTION_ERROR_REASON.ServerUnreachable:
    case CONNECTION_ERROR_REASON.WebSocket:
      return VoiceFailureKind.ServerUnreachable;
    case CONNECTION_ERROR_REASON.Timeout:
      // Signalling or the peer connection timed out: the classic blocked-UDP symptom.
      return VoiceFailureKind.MediaUnreachable;
    case CONNECTION_ERROR_REASON.InternalError:
      return /could not establish (pc|publisher|subscriber)/i.test(error.message)
        ? VoiceFailureKind.MediaUnreachable
        : VoiceFailureKind.ServerError;
    default:
      return VoiceFailureKind.ServerError;
  }
}

/**
 * The kind of a join failure, or null when it isn't one (a cancelled join).
 */
export function classifyJoinFailure(error: unknown): VoiceFailureKind | null {
  if (isLivekitConnectionError(error)) return classifyLivekit(error);

  const status = apiStatusOf(error);
  if (status !== null) {
    if (status === 401) return VoiceFailureKind.Session;
    if (status === 403) return VoiceFailureKind.Permission;
    if (status === 404) return VoiceFailureKind.NotFound;
    if (status >= 500 || status === 429) return VoiceFailureKind.ServerError;
    return VoiceFailureKind.Unknown;
  }

  // fetch() rejects with a TypeError when the API can't be reached at all.
  if (error instanceof TypeError) return VoiceFailureKind.ServerUnreachable;
  if (error instanceof Error && /LiveKit URL is missing/i.test(error.message)) {
    return VoiceFailureKind.ServerError;
  }
  if (error instanceof Error && /could not establish pc connection/i.test(error.message)) {
    return VoiceFailureKind.MediaUnreachable;
  }
  return VoiceFailureKind.Unknown;
}

/** A readable message from an API body or an Error. */
export function joinErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const { message } = error as { message?: unknown };
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(', ');
  }
  if (typeof error === 'string') return error;
  return null;
}
