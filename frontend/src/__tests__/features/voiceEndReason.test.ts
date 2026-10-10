import { describe, it, expect } from 'vitest';
import { VoiceEndReason } from '../../contexts/VoiceContext';
import {
  definitiveRejoinFailure,
  errorMessageOf,
  VOICE_END_MESSAGES,
} from '../../features/voice/voiceEndReason';

describe('definitiveRejoinFailure', () => {
  it.each([
    [{ statusCode: 401, message: 'Unauthorized' }, VoiceEndReason.SessionExpired],
    [{ statusCode: 403, message: 'Forbidden resource' }, VoiceEndReason.AccessLost],
    [{ statusCode: 404, message: 'Not Found' }, VoiceEndReason.ChannelNotFound],
  ])('%j is definitive', (error, reason) => {
    expect(definitiveRejoinFailure(error)).toBe(reason);
  });

  it.each([
    ['500', { statusCode: 500 }],
    ['502', { statusCode: 502 }],
    ['503', { statusCode: 503 }],
    ['429', { statusCode: 429 }],
    ['400', { statusCode: 400 }],
    ['a network TypeError', new TypeError('Failed to fetch')],
    ['an Error', new Error('timeout')],
    ['a string body', 'Bad Gateway'],
    ['null', null],
    ['an object with only `status`', { status: 403 }],
    [
      'a LiveKit ConnectionError (validate 401)',
      Object.assign(new Error('could not establish signal connection'), { name: 'ConnectionError', status: 401, reason: 1 }),
    ],
    [
      'a LiveKit ConnectionError (validate 403)',
      Object.assign(new Error('not allowed'), { name: 'ConnectionError', status: 403, reason: 1 }),
    ],
    [
      'an Error that happens to carry statusCode 404',
      Object.assign(new Error('x'), { statusCode: 404 }),
    ],
    ['undefined', undefined],
  ])('%s is retryable', (_label, error) => {
    expect(definitiveRejoinFailure(error)).toBeNull();
  });
});

describe('errorMessageOf', () => {
  it('reads Error and API-body messages', () => {
    expect(errorMessageOf(new Error('boom'))).toBe('boom');
    expect(errorMessageOf({ statusCode: 403, message: 'Forbidden resource' })).toBe('Forbidden resource');
    expect(errorMessageOf({ statusCode: 400, message: ['a', 'b'] })).toBe('a, b');
    expect(errorMessageOf('text')).toBeNull();
    expect(errorMessageOf(null)).toBeNull();
  });
});

describe('VOICE_END_MESSAGES', () => {
  it('has a message for every reason', () => {
    for (const reason of Object.values(VoiceEndReason)) {
      expect(VOICE_END_MESSAGES[reason]).toBeTruthy();
    }
  });
});
