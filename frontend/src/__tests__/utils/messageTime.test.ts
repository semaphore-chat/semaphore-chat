import { describe, it, expect } from 'vitest';
import {
  formatMessageTime,
  formatClockTime,
  formatDaySeparator,
  isSameDay,
} from '../../utils/messageTime';

// Dates are built from local components so the assertions hold in any TZ.
const now = new Date(2026, 8, 22, 18, 0); // Tue Sep 22 2026, 6:00 PM local
const L = 'en-US';

describe('formatClockTime', () => {
  it('formats hours and minutes only', () => {
    expect(formatClockTime(new Date(2026, 8, 22, 16, 12, 45), L)).toBe('4:12 PM');
    expect(formatClockTime(new Date(2026, 8, 22, 9, 5), L)).toBe('9:05 AM');
  });

  it('accepts ISO strings', () => {
    expect(formatClockTime(new Date(2026, 8, 22, 0, 30).toISOString(), L)).toBe('12:30 AM');
  });
});

describe('formatMessageTime', () => {
  it('shows only the time for today', () => {
    expect(formatMessageTime(new Date(2026, 8, 22, 16, 12), now, L)).toBe('4:12 PM');
    expect(formatMessageTime(new Date(2026, 8, 22, 0, 1), now, L)).toBe('12:01 AM');
  });

  it('shows "Yesterday" plus the time for yesterday', () => {
    expect(formatMessageTime(new Date(2026, 8, 21, 16, 12), now, L)).toBe('Yesterday 4:12 PM');
    expect(formatMessageTime(new Date(2026, 8, 21, 23, 59), now, L)).toBe('Yesterday 11:59 PM');
  });

  it('shows a short date and time earlier in the same year', () => {
    expect(formatMessageTime(new Date(2026, 8, 20, 16, 12), now, L)).toBe('Sep 20, 4:12 PM');
    expect(formatMessageTime(new Date(2026, 0, 3, 9, 0), now, L)).toBe('Jan 3, 9:00 AM');
  });

  it('shows a short date with the year for another year', () => {
    expect(formatMessageTime(new Date(2025, 11, 31, 16, 12), now, L)).toBe('Dec 31, 2025');
  });

  it('handles "yesterday" across a month boundary', () => {
    const firstOfMonth = new Date(2026, 9, 1, 8, 0);
    expect(formatMessageTime(new Date(2026, 8, 30, 22, 0), firstOfMonth, L)).toBe('Yesterday 10:00 PM');
  });

  it('accepts ISO strings', () => {
    expect(formatMessageTime(new Date(2026, 8, 22, 16, 12).toISOString(), now, L)).toBe('4:12 PM');
  });
});

describe('formatDaySeparator', () => {
  it('labels today and yesterday', () => {
    expect(formatDaySeparator(new Date(2026, 8, 22, 1, 0), now, L)).toBe('Today');
    expect(formatDaySeparator(new Date(2026, 8, 21, 23, 0), now, L)).toBe('Yesterday');
  });

  it('uses weekday, month and day within the year', () => {
    expect(formatDaySeparator(new Date(2026, 8, 18, 12, 0), now, L)).toBe('Friday, September 18');
  });

  it('adds the year for another year', () => {
    expect(formatDaySeparator(new Date(2025, 11, 31, 12, 0), now, L)).toBe('Wednesday, December 31, 2025');
  });
});

describe('isSameDay', () => {
  it('compares local calendar days', () => {
    expect(isSameDay(new Date(2026, 8, 22, 0, 0), new Date(2026, 8, 22, 23, 59))).toBe(true);
    expect(isSameDay(new Date(2026, 8, 21, 23, 59), new Date(2026, 8, 22, 0, 0))).toBe(false);
    expect(isSameDay(new Date(2025, 8, 22, 12, 0), new Date(2026, 8, 22, 12, 0))).toBe(false);
  });
});
