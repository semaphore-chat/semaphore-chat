/**
 * The words of a member row: pure, so tests and stories share them.
 */
import type { MemberSummary } from '../../../data/members';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Seen just now", "Seen 5m ago", "Seen 2h ago", "Seen yesterday", "Seen 3d ago"; null for a bad date. */
export function seenLine(lastSeen: string, now: number): string | null {
  const at = new Date(lastSeen).getTime();
  if (Number.isNaN(at)) return null;
  const ago = Math.max(0, now - at);
  if (ago < MINUTE) return 'Seen just now';
  if (ago < HOUR) return `Seen ${Math.floor(ago / MINUTE)}m ago`;
  if (ago < DAY) return `Seen ${Math.floor(ago / HOUR)}h ago`;
  const days = Math.floor(ago / DAY);
  return days === 1 ? 'Seen yesterday' : `Seen ${days}d ago`;
}

/**
 * The line under a member's name: what they said (their status text), else the voice room they are in,
 * else when an away member was last here (the mock-ups' order: "keeping the server warm", "In Squad Up",
 * "Seen 2h ago").
 */
export function memberLine(member: MemberSummary, now: number): string | undefined {
  if (member.statusText) return member.statusText;
  if (member.inRoom) return `In ${member.inRoom}`;
  if (member.presence === 'offline' && member.lastSeen) return seenLine(member.lastSeen, now) ?? undefined;
  return undefined;
}
