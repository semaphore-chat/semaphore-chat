import { describe, it, expect } from 'vitest';
import { VoiceFailureKind } from '../../contexts/VoiceContext';
import { classifyJoinFailure, joinErrorMessage, VOICE_FAILURE_COPY } from '../../features/voice/joinFailure';

/** A livekit-client ConnectionError as it arrives (name, numeric reason, optional status). */
function lkError(message: string, reason: number, status?: number) {
  return Object.assign(new Error(message), { name: 'ConnectionError', reason, status });
}

describe('classifyJoinFailure', () => {
  it.each([
    ['pc connection failed (UDP blocked)', lkError('could not establish pc connection', 2), VoiceFailureKind.MediaUnreachable],
    ['publisher connection failed', lkError('could not establish publisher connection, state: failed', 2), VoiceFailureKind.MediaUnreachable],
    ['a connection timeout', lkError('room connection has timed out', 5), VoiceFailureKind.MediaUnreachable],
    ['signal connection failed', lkError('could not establish signal connection', 1), VoiceFailureKind.ServerUnreachable],
    ['a websocket error', lkError('websocket closed', 6), VoiceFailureKind.ServerUnreachable],
    ['validate 401/403 (no CONNECT)', lkError('not allowed', 0, 403), VoiceFailureKind.Permission],
    ['validate 404', lkError('room not found', 0, 404), VoiceFailureKind.NotFound],
    ['another internal error', lkError('unexpected join response', 2), VoiceFailureKind.ServerError],
    ['a leave request', lkError('server asked to leave', 4), VoiceFailureKind.ServerError],
    ['API 401 (session gone after refresh)', { statusCode: 401, message: 'Unauthorized' }, VoiceFailureKind.Session],
    ['API 403', { statusCode: 403, message: 'Forbidden resource' }, VoiceFailureKind.Permission],
    ['API 404', { statusCode: 404, message: 'Not Found' }, VoiceFailureKind.NotFound],
    ['API 500', { statusCode: 500, message: 'Internal server error' }, VoiceFailureKind.ServerError],
    ['API 503', { statusCode: 503, message: 'Service Unavailable' }, VoiceFailureKind.ServerError],
    ['API 429', { statusCode: 429, message: 'Too Many Requests' }, VoiceFailureKind.ServerError],
    ['API 400', { statusCode: 400, message: 'Bad Request' }, VoiceFailureKind.Unknown],
    ['API unreachable (fetch TypeError)', new TypeError('Failed to fetch'), VoiceFailureKind.ServerUnreachable],
    ['a missing LiveKit URL', new Error('LiveKit URL is missing. Check backend LIVEKIT_URL configuration.'), VoiceFailureKind.ServerError],
    ['anything else', new Error('boom'), VoiceFailureKind.Unknown],
    ['a non-error', 'weird', VoiceFailureKind.Unknown],
  ])('%s', (_label, error, kind) => {
    expect(classifyJoinFailure(error)).toBe(kind);
  });

  it('a cancelled connect (hang-up while connecting) is not a failure', () => {
    expect(classifyJoinFailure(lkError('Signal connection aborted', 3))).toBeNull();
  });
});

describe('VOICE_FAILURE_COPY', () => {
  it('offers Retry only where trying again can help', () => {
    const retryable = Object.entries(VOICE_FAILURE_COPY)
      .filter(([, copy]) => copy.retryable)
      .map(([kind]) => kind)
      .sort();
    expect(retryable).toEqual(
      [
        VoiceFailureKind.MediaUnreachable,
        VoiceFailureKind.ServerUnreachable,
        VoiceFailureKind.ServerError,
        VoiceFailureKind.Unknown,
      ].sort(),
    );
  });

  it('tells a blocked-UDP user what to do', () => {
    expect(VOICE_FAILURE_COPY[VoiceFailureKind.MediaUnreachable].message).toMatch(/UDP.*TURN/);
  });
});

describe('joinErrorMessage', () => {
  it('reads errors, API bodies and strings', () => {
    expect(joinErrorMessage(new Error('x'))).toBe('x');
    expect(joinErrorMessage({ statusCode: 403, message: 'Forbidden resource' })).toBe('Forbidden resource');
    expect(joinErrorMessage({ statusCode: 400, message: ['a', 'b'] })).toBe('a, b');
    expect(joinErrorMessage('text')).toBe('text');
    expect(joinErrorMessage(undefined)).toBeNull();
  });
});
