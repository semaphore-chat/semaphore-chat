/**
 * Compact DM list names.
 *
 * `getDmDisplayName` joins every other member's name, which for a large
 * unnamed group DM produces a paragraph. List rows need one short line:
 * up to three names in full, otherwise "A, B + N". `full` carries the whole
 * list for a title/tooltip.
 */
import { getDmDisplayName } from './dmHelpers';
import type { DirectMessageGroup } from '../types/direct-message.type';

/** Show every name up to this many; beyond it collapse to COLLAPSED_NAMES + count. */
const MAX_FULL_NAMES = 3;
const COLLAPSED_NAMES = 2;

export interface CompactDmName {
  /** The whole one-line label, e.g. "A, B + 13". */
  label: string;
  /** Every name, for a title/tooltip. */
  full: string;
  /** The names part of `label` ("A, B") — the part that may be ellipsised. */
  names: string;
  /** How many members are folded into "+ N" (0 when none). */
  extra: number;
}

export function getCompactDmName(
  group: DirectMessageGroup,
  currentUserId: string | undefined,
): CompactDmName {
  if (group.name || !group.isGroup) {
    const name = getDmDisplayName(group, currentUserId);
    return { label: name, full: name, names: name, extra: 0 };
  }

  const names = (group.members ?? [])
    .filter((m) => m.user.id !== currentUserId)
    .map((m) => m.user.displayName || m.user.username);

  if (names.length === 0) return { label: 'Group Chat', full: 'Group Chat', names: 'Group Chat', extra: 0 };

  const full = names.join(', ');
  if (names.length <= MAX_FULL_NAMES) return { label: full, full, names: full, extra: 0 };

  const shown = names.slice(0, COLLAPSED_NAMES).join(', ');
  const extra = names.length - COLLAPSED_NAMES;
  return { label: `${shown} + ${extra}`, full, names: shown, extra };
}
