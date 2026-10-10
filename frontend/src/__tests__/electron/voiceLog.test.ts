import { describe, it, expect } from 'vitest';
import { formatVoiceLogEntry, VOICE_LOG_DATA_MAX } from '../../../electron/voiceLog';

describe('formatVoiceLogEntry (renderer input to the desktop log file)', () => {
  it('formats a valid entry', () => {
    expect(
      formatVoiceLogEntry({ level: 'warn', event: 'join-failed', data: { errorKind: 'permission' } }),
    ).toEqual({ level: 'warn', line: 'join-failed {"errorKind":"permission"}' });
  });

  it('accepts an entry without data', () => {
    expect(formatVoiceLogEntry({ level: 'info', event: 'system-resume' })).toEqual({
      level: 'info',
      line: 'system-resume',
    });
  });

  it.each([
    ['null', null],
    ['a string', 'boom'],
    ['an unknown level', { level: 'debug', event: 'x' }],
    ['a missing event', { level: 'info' }],
    ['an empty event', { level: 'info', event: '' }],
    ['array data', { level: 'info', event: 'x', data: [1, 2] }],
    ['circular data', (() => { const d: Record<string, unknown> = {}; d.self = d; return { level: 'info', event: 'x', data: d }; })()],
  ])('drops %s', (_label, raw) => {
    expect(formatVoiceLogEntry(raw)).toBeNull();
  });

  it('caps the data size and sanitizes the event name', () => {
    const entry = formatVoiceLogEntry({
      level: 'error',
      event: 'join failed\nINJECTED',
      data: { message: 'x'.repeat(10_000) },
    });
    expect(entry?.line.startsWith('join_failed_INJECTED ')).toBe(true);
    expect(entry!.line.length).toBeLessThan(VOICE_LOG_DATA_MAX + 100);
  });
});
