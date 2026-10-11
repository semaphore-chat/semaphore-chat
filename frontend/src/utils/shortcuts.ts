/**
 * Keyboard shortcuts: the one table the global handler, the shortcut sheet
 * and the `aria-keyshortcuts` attributes read from.
 *
 * "Mod" is Cmd on macOS and Ctrl elsewhere; Alt is Option on macOS.
 */
import { isMacPlatform } from './platform';

export type ShortcutId =
  | 'prevChannel'
  | 'nextChannel'
  | 'prevUnread'
  | 'nextUnread'
  | 'escape'
  | 'editLast'
  | 'shortcutSheet';

export type ShortcutGroup = 'Navigation' | 'Messages' | 'Help';

/** A key in a combo: a modifier name or a `KeyboardEvent.key` value. */
type ComboKey = 'Mod' | 'Alt' | 'Shift' | 'ArrowUp' | 'ArrowDown' | 'Escape' | '/';

export interface ShortcutDef {
  id: ShortcutId;
  group: ShortcutGroup;
  description: string;
  keys: ComboKey[];
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'prevChannel', group: 'Navigation', description: 'Previous channel or conversation', keys: ['Alt', 'ArrowUp'] },
  { id: 'nextChannel', group: 'Navigation', description: 'Next channel or conversation', keys: ['Alt', 'ArrowDown'] },
  { id: 'prevUnread', group: 'Navigation', description: 'Previous unread channel or conversation', keys: ['Alt', 'Shift', 'ArrowUp'] },
  { id: 'nextUnread', group: 'Navigation', description: 'Next unread channel or conversation', keys: ['Alt', 'Shift', 'ArrowDown'] },
  { id: 'escape', group: 'Messages', description: 'Close the side panel, or mark the conversation read', keys: ['Escape'] },
  { id: 'editLast', group: 'Messages', description: 'Edit your last message (in an empty message box)', keys: ['ArrowUp'] },
  { id: 'shortcutSheet', group: 'Help', description: 'Show keyboard shortcuts', keys: ['Mod', '/'] },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['Navigation', 'Messages', 'Help'];

export function getShortcut(id: ShortcutId): ShortcutDef {
  const def = SHORTCUTS.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown shortcut: ${id}`);
  return def;
}

const LABELS: Record<ComboKey, { mac: string; pc: string; spoken: string }> = {
  Mod: { mac: '⌘', pc: 'Ctrl', spoken: 'Control' },
  Alt: { mac: '⌥', pc: 'Alt', spoken: 'Alt' },
  Shift: { mac: '⇧', pc: 'Shift', spoken: 'Shift' },
  ArrowUp: { mac: '↑', pc: '↑', spoken: 'Up arrow' },
  ArrowDown: { mac: '↓', pc: '↓', spoken: 'Down arrow' },
  Escape: { mac: 'Esc', pc: 'Esc', spoken: 'Escape' },
  '/': { mac: '/', pc: '/', spoken: 'Slash' },
};

/** The visible key caps for a shortcut, e.g. `['Ctrl', '/']` or `['⌘', '/']`. */
export function shortcutKeyLabels(id: ShortcutId, mac: boolean = isMacPlatform()): string[] {
  return getShortcut(id).keys.map((k) => (mac ? LABELS[k].mac : LABELS[k].pc));
}

/** A screen-reader label, e.g. "Alt plus Shift plus Down arrow". */
export function shortcutSpokenLabel(id: ShortcutId, mac: boolean = isMacPlatform()): string {
  return getShortcut(id)
    .keys.map((k) => (k === 'Mod' ? (mac ? 'Command' : 'Control') : k === 'Alt' && mac ? 'Option' : LABELS[k].spoken))
    .join(' plus ');
}

/** A compact text hint for menus and tooltips, e.g. "Ctrl+/" or "⌘/". */
export function shortcutHint(id: ShortcutId, mac: boolean = isMacPlatform()): string {
  return shortcutKeyLabels(id, mac).join(mac ? '' : '+');
}

/** The `aria-keyshortcuts` value (WAI-ARIA syntax), e.g. "Control+/" or "Meta+/". */
export function ariaKeyShortcuts(ids: ShortcutId[], mac: boolean = isMacPlatform()): string {
  return ids
    .map((id) =>
      getShortcut(id)
        .keys.map((k) => (k === 'Mod' ? (mac ? 'Meta' : 'Control') : k))
        .join('+'),
    )
    .join(' ');
}

// ── Matching ───────────────────────────────────────────────────────────────

type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
>;

/** Which global shortcut (if any) a keydown is. `editLast` is matched by the composer itself. */
export function matchGlobalShortcut(event: KeyEventLike, mac: boolean = isMacPlatform()): ShortcutId | null {
  const { key, code, altKey, ctrlKey, metaKey, shiftKey } = event;

  if (altKey && !ctrlKey && !metaKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
    if (shiftKey) return key === 'ArrowUp' ? 'prevUnread' : 'nextUnread';
    return key === 'ArrowUp' ? 'prevChannel' : 'nextChannel';
  }

  const mod = mac ? metaKey && !ctrlKey : ctrlKey && !metaKey;
  // Shift is allowed: on many layouts "/" itself needs Shift (German: Shift+7).
  if (mod && !altKey && (key === '/' || code === 'Slash')) return 'shortcutSheet';

  if (key === 'Escape' && !altKey && !ctrlKey && !metaKey && !shiftKey) return 'escape';

  return null;
}

/** Marks the main message composer, where navigation shortcuts still fire. */
export const COMPOSER_SCOPE_ATTR = 'data-shortcut-scope';
export const COMPOSER_SCOPE_VALUE = 'composer';

/**
 * True for elements that take typed or arrow-key input of their own (text
 * fields, selects, comboboxes, listboxes, menus, sliders): global shortcuts
 * other than the shortcut sheet stay out of their way.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(
    target.closest('[role="combobox"], [role="listbox"], [role="menu"], [role="slider"], [role="spinbutton"]'),
  );
}

/** True when the event comes from the main message composer. */
export function isComposerTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(`[${COMPOSER_SCOPE_ATTR}="${COMPOSER_SCOPE_VALUE}"]`));
}

/** Focus the main composer's text field (without scrolling); false when there is none. */
export function focusComposer(doc: Document = document): boolean {
  const field = doc.querySelector<HTMLElement>(
    `[${COMPOSER_SCOPE_ATTR}="${COMPOSER_SCOPE_VALUE}"] textarea:not([aria-hidden])`,
  );
  field?.focus({ preventScroll: true });
  return Boolean(field);
}

/** True when a MUI modal (dialog, menu, popover, drawer) is open. */
export function isModalOpen(doc: Document = document): boolean {
  return Boolean(doc.querySelector('.MuiModal-root:not(.MuiModal-hidden)'));
}

// ── Sidebar order ──────────────────────────────────────────────────────────

export interface NavItem {
  id: string;
  label: string;
  unread: boolean;
}

/**
 * The item `step` places from the current one (wrapping). With `unreadOnly`,
 * the first unread item in that direction, never the current one; null when
 * there is none. An unknown current id starts from just outside the list.
 */
export function findNavTarget(
  items: readonly NavItem[],
  currentId: string | undefined,
  direction: 1 | -1,
  unreadOnly: boolean,
): NavItem | null {
  const n = items.length;
  if (n === 0) return null;
  const currentIndex = currentId ? items.findIndex((i) => i.id === currentId) : -1;
  const start = currentIndex >= 0 ? currentIndex : direction === 1 ? -1 : n;
  for (let step = 1; step <= n; step++) {
    const index = (((start + direction * step) % n) + n) % n;
    const item = items[index];
    if (index === currentIndex) return null;
    if (!unreadOnly || item.unread) return item;
  }
  return null;
}
