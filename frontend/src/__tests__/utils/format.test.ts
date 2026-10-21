import { describe, it, expect } from 'vitest';
import { formatFileSize, formatPlaybackTime, getErrorMessage } from '../../utils/format';

describe('formatFileSize', () => {
  it('returns "0 Bytes" for 0', () => {
    expect(formatFileSize(0)).toBe('0 Bytes');
  });

  it('formats bytes', () => {
    expect(formatFileSize(500)).toBe('500 Bytes');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1 MB');
    expect(formatFileSize(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatFileSize(524288000)).toBe('500 MB');
  });

  it('formats gigabytes', () => {
    expect(formatFileSize(1073741824)).toBe('1 GB');
  });

  it('formats terabytes', () => {
    expect(formatFileSize(1024 ** 4)).toBe('1 TB');
  });

  it('returns "0 Bytes" for negative values', () => {
    expect(formatFileSize(-1024)).toBe('0 Bytes');
  });

  it('returns "0 Bytes" for NaN and Infinity', () => {
    expect(formatFileSize(NaN)).toBe('0 Bytes');
    expect(formatFileSize(Infinity)).toBe('0 Bytes');
  });
});

describe('formatPlaybackTime', () => {
  it('formats 0 as "0:00"', () => {
    expect(formatPlaybackTime(0)).toBe('0:00');
  });

  it('formats 65 as "1:05"', () => {
    expect(formatPlaybackTime(65)).toBe('1:05');
  });

  it('formats 3661 as "61:01"', () => {
    expect(formatPlaybackTime(3661)).toBe('61:01');
  });
});

describe('getErrorMessage', () => {
  it('reads the message from an API client error body', () => {
    expect(getErrorMessage({ statusCode: 409, message: 'Clip is locked', error: 'Conflict' }, 'fallback')).toBe('Clip is locked');
  });

  it('joins NestJS validation message arrays', () => {
    expect(getErrorMessage({ statusCode: 400, message: ['name is too long', 'bio is required'] }, 'fallback')).toBe(
      'name is too long. bio is required',
    );
  });

  it('keeps reading axios-style data.message and Error.message', () => {
    expect(getErrorMessage({ data: { message: 'From data' } }, 'fallback')).toBe('From data');
    expect(getErrorMessage(new Error('Boom'), 'fallback')).toBe('Boom');
  });

  it('falls back when there is no usable message', () => {
    expect(getErrorMessage({ message: '' }, 'fallback')).toBe('fallback');
    expect(getErrorMessage({ message: [42] }, 'fallback')).toBe('fallback');
    expect(getErrorMessage('nope', 'fallback')).toBe('fallback');
    expect(getErrorMessage(null, 'fallback')).toBe('fallback');
  });
});
