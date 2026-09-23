/**
 * Message timestamp formatting.
 *
 * Chat rows show a compact time instead of the full locale date string:
 * - today            → "4:12 PM"
 * - yesterday        → "Yesterday 4:12 PM"
 * - earlier this year → "Sep 20, 4:12 PM"
 * - another year     → "Dec 31, 2025"
 *
 * `now` and `locale` are parameters so tests are deterministic; callers
 * normally omit both (current time, the user's locale).
 */

type DateInput = string | number | Date;

const toDate = (value: DateInput): Date => (value instanceof Date ? value : new Date(value));

/** True when both dates fall on the same local calendar day. */
export function isSameDay(a: DateInput, b: DateInput): boolean {
  const x = toDate(a);
  const y = toDate(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

function isYesterday(date: Date, now: Date): boolean {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return isSameDay(date, yesterday);
}

/** "4:12 PM" — hours and minutes only. */
export function formatClockTime(value: DateInput, locale?: string): string {
  return toDate(value).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/** Compact timestamp for a message header (see module doc). */
export function formatMessageTime(value: DateInput, now: Date = new Date(), locale?: string): string {
  const date = toDate(value);
  const time = formatClockTime(date, locale);
  if (isSameDay(date, now)) return time;
  if (isYesterday(date, now)) return `Yesterday ${time}`;
  if (date.getFullYear() === now.getFullYear()) {
    const day = date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    return `${day}, ${time}`;
  }
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Label for a day separator: "Today", "Yesterday", "Friday, September 18" (+ year when not this year). */
export function formatDaySeparator(value: DateInput, now: Date = new Date(), locale?: string): string {
  const date = toDate(value);
  if (isSameDay(date, now)) return 'Today';
  if (isYesterday(date, now)) return 'Yesterday';
  return date.toLocaleDateString(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Full date and time, for tooltips on the compact labels. */
export function formatFullTimestamp(value: DateInput, locale?: string): string {
  return toDate(value).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' });
}
