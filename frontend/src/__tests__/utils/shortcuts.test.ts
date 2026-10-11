import { describe, it, expect } from 'vitest';
import {
  SHORTCUTS,
  ariaKeyShortcuts,
  findNavTarget,
  isComposerTarget,
  isEditableTarget,
  matchGlobalShortcut,
  shortcutHint,
  shortcutKeyLabels,
  shortcutSpokenLabel,
  type NavItem,
} from '../../utils/shortcuts';

const key = (k: string, mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}, code = '') => ({
  key: k,
  code,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe('matchGlobalShortcut', () => {
  it('maps Alt(+Shift)+arrows to channel and unread navigation', () => {
    expect(matchGlobalShortcut(key('ArrowUp', { altKey: true }), false)).toBe('prevChannel');
    expect(matchGlobalShortcut(key('ArrowDown', { altKey: true }), false)).toBe('nextChannel');
    expect(matchGlobalShortcut(key('ArrowUp', { altKey: true, shiftKey: true }), false)).toBe('prevUnread');
    expect(matchGlobalShortcut(key('ArrowDown', { altKey: true, shiftKey: true }), true)).toBe('nextUnread');
  });

  it('ignores arrows without Alt, or with Ctrl/Cmd as well', () => {
    expect(matchGlobalShortcut(key('ArrowDown'), false)).toBeNull();
    expect(matchGlobalShortcut(key('ArrowDown', { altKey: true, ctrlKey: true }), false)).toBeNull();
    expect(matchGlobalShortcut(key('ArrowDown', { altKey: true, metaKey: true }), true)).toBeNull();
  });

  it('uses Ctrl+/ off Mac and Cmd+/ on Mac, with or without Shift', () => {
    expect(matchGlobalShortcut(key('/', { ctrlKey: true }, 'Slash'), false)).toBe('shortcutSheet');
    expect(matchGlobalShortcut(key('?', { ctrlKey: true, shiftKey: true }, 'Slash'), false)).toBe('shortcutSheet');
    // German layout: "/" is Shift+7.
    expect(matchGlobalShortcut(key('/', { ctrlKey: true, shiftKey: true }, 'Digit7'), false)).toBe('shortcutSheet');
    expect(matchGlobalShortcut(key('/', { metaKey: true }, 'Slash'), false)).toBeNull();
    expect(matchGlobalShortcut(key('/', { metaKey: true }, 'Slash'), true)).toBe('shortcutSheet');
    expect(matchGlobalShortcut(key('/', { ctrlKey: true }, 'Slash'), true)).toBeNull();
  });

  it('matches a bare Esc only', () => {
    expect(matchGlobalShortcut(key('Escape'), false)).toBe('escape');
    expect(matchGlobalShortcut(key('Escape', { shiftKey: true }), false)).toBeNull();
  });

  it('does not bind Ctrl+K (the quick switcher is not built yet)', () => {
    expect(matchGlobalShortcut(key('k', { ctrlKey: true }, 'KeyK'), false)).toBeNull();
    expect(SHORTCUTS.map((s) => s.description).join(' ')).not.toMatch(/switch/i);
  });
});

describe('labels', () => {
  it('formats key caps, hints, spoken labels and aria-keyshortcuts per platform', () => {
    expect(shortcutKeyLabels('shortcutSheet', false)).toEqual(['Ctrl', '/']);
    expect(shortcutKeyLabels('shortcutSheet', true)).toEqual(['⌘', '/']);
    expect(shortcutKeyLabels('nextUnread', true)).toEqual(['⌥', '⇧', '↓']);
    expect(shortcutHint('shortcutSheet', false)).toBe('Ctrl+/');
    expect(shortcutHint('shortcutSheet', true)).toBe('⌘/');
    expect(shortcutSpokenLabel('nextUnread', false)).toBe('Alt plus Shift plus Down arrow');
    expect(shortcutSpokenLabel('prevChannel', true)).toBe('Option plus Up arrow');
    expect(ariaKeyShortcuts(['shortcutSheet'], false)).toBe('Control+/');
    expect(ariaKeyShortcuts(['shortcutSheet'], true)).toBe('Meta+/');
    expect(ariaKeyShortcuts(['prevChannel', 'nextUnread'], false)).toBe('Alt+ArrowUp Alt+Shift+ArrowDown');
  });
});

describe('findNavTarget', () => {
  const items: NavItem[] = [
    { id: 'a', label: '#a', unread: false },
    { id: 'b', label: '#b', unread: true },
    { id: 'c', label: '#c', unread: false },
    { id: 'd', label: '#d', unread: true },
  ];

  it('steps through the list and wraps at both ends', () => {
    expect(findNavTarget(items, 'a', 1, false)?.id).toBe('b');
    expect(findNavTarget(items, 'd', 1, false)?.id).toBe('a');
    expect(findNavTarget(items, 'a', -1, false)?.id).toBe('d');
  });

  it('starts from the ends when nothing in the list is current', () => {
    expect(findNavTarget(items, undefined, 1, false)?.id).toBe('a');
    expect(findNavTarget(items, 'elsewhere', -1, false)?.id).toBe('d');
  });

  it('finds the next unread item in either direction, wrapping, never the current one', () => {
    expect(findNavTarget(items, 'b', 1, true)?.id).toBe('d');
    expect(findNavTarget(items, 'd', 1, true)?.id).toBe('b');
    expect(findNavTarget(items, 'c', -1, true)?.id).toBe('b');
    expect(findNavTarget([{ id: 'x', label: 'x', unread: true }], 'x', 1, true)).toBeNull();
  });

  it('returns null with nothing unread, an empty list, or a one-item list', () => {
    const read = items.map((i) => ({ ...i, unread: false }));
    expect(findNavTarget(read, 'a', 1, true)).toBeNull();
    expect(findNavTarget([], undefined, 1, false)).toBeNull();
    expect(findNavTarget([items[0]], 'a', 1, false)).toBeNull();
  });
});

describe('targets', () => {
  it('treats text fields, selects and comboboxes as editable, buttons not', () => {
    document.body.innerHTML = `
      <input id="i" /><textarea id="t"></textarea><select id="s"></select>
      <div role="combobox"><span id="cb"></span></div><button id="b"></button>
      <div data-shortcut-scope="composer"><textarea id="composer"></textarea></div>`;
    const el = (id: string) => document.getElementById(id);
    expect(isEditableTarget(el('i'))).toBe(true);
    expect(isEditableTarget(el('t'))).toBe(true);
    expect(isEditableTarget(el('s'))).toBe(true);
    expect(isEditableTarget(el('cb'))).toBe(true);
    expect(isEditableTarget(el('b'))).toBe(false);
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isComposerTarget(el('composer'))).toBe(true);
    expect(isComposerTarget(el('t'))).toBe(false);
  });
});
