/**
 * useComposerKeys: the composer key rules lifted from MessageInput. These pin
 * what the classic composer does today (including that it has no IME guard),
 * not what it should do.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type React from 'react';
import { renderHook } from '@testing-library/react';
import {
  useComposerKeys,
  type SimpleMentionState,
  type UseComposerKeysOptions,
} from '../../../data/chat/useComposerKeys';
import type { MentionSuggestion } from '../../../data/chat/useMentionHandling';

interface KeyInit {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

/** A React keyboard event whose nativeEvent is itself (one preventDefault spy). */
function keyEvent(init: KeyInit) {
  const preventDefault = vi.fn();
  const ev: Record<string, unknown> = {
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    keyCode: 0,
    ...init,
    preventDefault,
  };
  ev.nativeEvent = ev;
  return { event: ev as unknown as React.KeyboardEvent, preventDefault };
}

const alice: MentionSuggestion = { id: 'u1', type: 'user', displayName: 'Alice', username: 'alice' };
const bob: MentionSuggestion = { id: 'u2', type: 'user', displayName: 'Bob', username: 'bob' };

const closedDm: SimpleMentionState = {
  isOpen: false,
  suggestions: [],
  selectedIndex: 0,
  query: '',
  type: null,
  isLoading: false,
};

function setup(overrides: Partial<UseComposerKeysOptions> = {}) {
  const input = document.createElement('textarea') as unknown as HTMLInputElement;
  document.body.appendChild(input);
  const options: UseComposerKeysOptions = {
    inputRef: { current: input },
    text: '',
    setText: vi.fn(),
    selectedFiles: [],
    isTouchDevice: false,
    isChannel: true,
    mentionHook: {
      state: { isOpen: false, suggestions: [], selectedIndex: 0, query: '', type: null, isLoading: false },
      handleKeyDown: vi.fn(() => false),
      getSelectedSuggestion: vi.fn(() => null),
    } as unknown as UseComposerKeysOptions['mentionHook'],
    dmMentionState: closedDm,
    setDmMentionState: vi.fn(),
    handleDmInsertMention: vi.fn(),
    closeDmMentions: vi.fn(),
    handleMentionSelect: vi.fn(),
    handleSend: vi.fn(() => Promise.resolve()),
    onEditLastMessage: undefined,
    onCancelReply: undefined,
    ...overrides,
  };
  const { result } = renderHook(() => useComposerKeys(options));
  const press = (init: KeyInit) => {
    const e = keyEvent(init);
    result.current.handleKeyPress(e.event);
    return e;
  };
  return { options, input, press };
}

function openChannelMentions(handled: boolean, selected: unknown = alice, selectedIndex = 1) {
  return {
    state: { isOpen: true, suggestions: [alice, bob], selectedIndex, query: 'a', type: 'user', isLoading: false },
    handleKeyDown: vi.fn(() => handled),
    getSelectedSuggestion: vi.fn(() => selected),
  } as unknown as UseComposerKeysOptions['mentionHook'];
}

const openDm = (selectedIndex = 0): SimpleMentionState => ({
  isOpen: true,
  suggestions: [alice, bob],
  selectedIndex,
  query: 'a',
  type: 'user',
  isLoading: false,
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useComposerKeys', () => {
  describe('Enter', () => {
    it('sends on desktop and prevents the newline', () => {
      const { options, press } = setup();
      const { preventDefault } = press({ key: 'Enter' });
      expect(options.handleSend).toHaveBeenCalledTimes(1);
      expect(preventDefault).toHaveBeenCalled();
    });

    it('Shift+Enter inserts a newline (no send, default kept)', () => {
      const { options, press } = setup();
      const { preventDefault } = press({ key: 'Enter', shiftKey: true });
      expect(options.handleSend).not.toHaveBeenCalled();
      expect(preventDefault).not.toHaveBeenCalled();
    });

    it('on touch, Enter inserts a newline (send is the button only)', () => {
      const { options, press } = setup({ isTouchDevice: true });
      const { preventDefault } = press({ key: 'Enter' });
      expect(options.handleSend).not.toHaveBeenCalled();
      expect(preventDefault).not.toHaveBeenCalled();
    });

    it('sends even with Ctrl held (Ctrl+Enter is not a formatting shortcut)', () => {
      const { options, press } = setup();
      press({ key: 'Enter', ctrlKey: true });
      expect(options.handleSend).toHaveBeenCalledTimes(1);
    });

    // Classic has no IME guard: Enter that confirms a composition still sends.
    it('sends during IME composition (isComposing) — no IME guard today', () => {
      const { options, press } = setup();
      press({ key: 'Enter', isComposing: true });
      expect(options.handleSend).toHaveBeenCalledTimes(1);
    });

    it('does not look at keyCode 229 (key "Process" does nothing, key "Enter" sends)', () => {
      const { options, press } = setup();
      press({ key: 'Process', keyCode: 229, isComposing: true });
      expect(options.handleSend).not.toHaveBeenCalled();
      press({ key: 'Enter', keyCode: 229, isComposing: true });
      expect(options.handleSend).toHaveBeenCalledTimes(1);
    });

    it('other keys do nothing', () => {
      const { options, press } = setup();
      const { preventDefault } = press({ key: 'a' });
      expect(options.handleSend).not.toHaveBeenCalled();
      expect(options.setText).not.toHaveBeenCalled();
      expect(preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('rich-text shortcuts', () => {
    let raf: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    });
    afterEach(() => raf.mockRestore());

    it('Ctrl+B wraps the selection in ** and restores focus and selection', () => {
      const { options, input, press } = setup();
      input.value = 'say hi now';
      input.setSelectionRange(4, 6);
      const { preventDefault } = press({ key: 'b', ctrlKey: true });
      expect(preventDefault).toHaveBeenCalled();
      expect(options.setText).toHaveBeenCalledWith('say **hi** now');
      expect(document.activeElement).toBe(input);
      expect([input.selectionStart, input.selectionEnd]).toEqual([6, 8]);
    });

    it('Cmd+I wraps in _ (meta works like ctrl; key case ignored)', () => {
      const { options, input, press } = setup();
      input.value = 'hi';
      input.setSelectionRange(0, 2);
      press({ key: 'I', metaKey: true });
      expect(options.setText).toHaveBeenCalledWith('_hi_');
    });

    it('is ignored with Shift or Alt held, and for other letters', () => {
      const { options, input, press } = setup();
      input.value = 'hi';
      press({ key: 'b', ctrlKey: true, shiftKey: true });
      press({ key: 'b', ctrlKey: true, altKey: true });
      const { preventDefault } = press({ key: 'k', ctrlKey: true });
      expect(options.setText).not.toHaveBeenCalled();
      expect(preventDefault).not.toHaveBeenCalled();
    });

    it('is handled (default prevented, nothing else runs) even with no input mounted', () => {
      const onCancelReply = vi.fn();
      const { options, press } = setup({ inputRef: { current: null }, onCancelReply });
      const { preventDefault } = press({ key: 'b', ctrlKey: true });
      expect(preventDefault).toHaveBeenCalled();
      expect(options.setText).not.toHaveBeenCalled();
    });

    it('wins over an open mention list', () => {
      const mentionHook = openChannelMentions(true);
      const { press } = setup({ mentionHook });
      press({ key: 'b', ctrlKey: true });
      expect(mentionHook.handleKeyDown).not.toHaveBeenCalled();
    });
  });

  describe('Escape', () => {
    it('cancels an active reply and prevents the default (so the global Esc does not also run)', () => {
      const onCancelReply = vi.fn();
      const { press } = setup({ onCancelReply });
      const { preventDefault } = press({ key: 'Escape' });
      expect(onCancelReply).toHaveBeenCalledTimes(1);
      expect(preventDefault).toHaveBeenCalled();
    });

    it('without a reply, is left alone', () => {
      const { press } = setup();
      const { preventDefault } = press({ key: 'Escape' });
      expect(preventDefault).not.toHaveBeenCalled();
    });

    it('closes an open channel mention list first; the reply stays', () => {
      const onCancelReply = vi.fn();
      const mentionHook = openChannelMentions(true);
      const { press } = setup({ mentionHook, onCancelReply });
      press({ key: 'Escape' });
      expect(mentionHook.handleKeyDown).toHaveBeenCalled();
      expect(onCancelReply).not.toHaveBeenCalled();
    });

    it('closes an open DM mention list first; the reply stays', () => {
      const onCancelReply = vi.fn();
      const { options, press } = setup({ isChannel: false, dmMentionState: openDm(), onCancelReply });
      const { preventDefault } = press({ key: 'Escape' });
      expect(options.closeDmMentions).toHaveBeenCalledTimes(1);
      expect(preventDefault).toHaveBeenCalled();
      expect(onCancelReply).not.toHaveBeenCalled();
    });
  });

  describe('↑ hands off to edit-last', () => {
    it('in an empty composer on desktop: asks to edit, prevents the default when it opened', () => {
      const onEditLastMessage = vi.fn(() => true);
      const { press } = setup({ onEditLastMessage });
      const { preventDefault } = press({ key: 'ArrowUp' });
      expect(onEditLastMessage).toHaveBeenCalledTimes(1);
      expect(preventDefault).toHaveBeenCalled();
    });

    it('keeps the default when there was nothing to edit', () => {
      const onEditLastMessage = vi.fn(() => false);
      const { press } = setup({ onEditLastMessage });
      const { preventDefault } = press({ key: 'ArrowUp' });
      expect(onEditLastMessage).toHaveBeenCalledTimes(1);
      expect(preventDefault).not.toHaveBeenCalled();
    });

    it.each([
      ['there is text', { text: 'draft' }, {}],
      ['files are attached', { selectedFiles: [new File(['x'], 'a.txt')] }, {}],
      ['on touch', { isTouchDevice: true }, {}],
      ['with Shift', {}, { shiftKey: true }],
      ['with Alt', {}, { altKey: true }],
      ['with Ctrl', {}, { ctrlKey: true }],
      ['with Meta', {}, { metaKey: true }],
    ])('does nothing when %s', (_label, opts, mods) => {
      const onEditLastMessage = vi.fn(() => true);
      const { press } = setup({ onEditLastMessage, ...opts });
      const { preventDefault } = press({ key: 'ArrowUp', ...mods });
      expect(onEditLastMessage).not.toHaveBeenCalled();
      expect(preventDefault).not.toHaveBeenCalled();
    });

    it('goes to an open mention list instead', () => {
      const onEditLastMessage = vi.fn(() => true);
      const { options, press } = setup({ isChannel: false, dmMentionState: openDm(1), onEditLastMessage });
      press({ key: 'ArrowUp' });
      expect(onEditLastMessage).not.toHaveBeenCalled();
      expect(options.setDmMentionState).toHaveBeenCalledTimes(1);
    });
  });

  describe('channel mention list (server-backed)', () => {
    it('is not consulted while closed', () => {
      const { options, press } = setup();
      press({ key: 'Enter' });
      expect(options.mentionHook.handleKeyDown).not.toHaveBeenCalled();
      expect(options.handleSend).toHaveBeenCalled();
    });

    it.each(['Enter', 'Tab'])('%s picks the selected suggestion (by index) and does not send', (key) => {
      const mentionHook = openChannelMentions(true, alice, 1);
      const { options, press } = setup({ mentionHook });
      press({ key });
      expect(mentionHook.handleKeyDown).toHaveBeenCalledTimes(1);
      expect(options.handleMentionSelect).toHaveBeenCalledWith(1);
      expect(options.handleSend).not.toHaveBeenCalled();
    });

    it('Enter with no selected suggestion picks nothing and does not send', () => {
      const mentionHook = openChannelMentions(true, null);
      const { options, press } = setup({ mentionHook });
      press({ key: 'Enter' });
      expect(options.handleMentionSelect).not.toHaveBeenCalled();
      expect(options.handleSend).not.toHaveBeenCalled();
    });

    it('arrow keys handled by the list pick nothing', () => {
      const mentionHook = openChannelMentions(true);
      const { options, press } = setup({ mentionHook });
      press({ key: 'ArrowDown' });
      expect(mentionHook.handleKeyDown).toHaveBeenCalled();
      expect(options.handleMentionSelect).not.toHaveBeenCalled();
    });

    it('a key the list does not handle falls through (Enter sends)', () => {
      const mentionHook = openChannelMentions(false);
      const { options, press } = setup({ mentionHook });
      press({ key: 'Enter' });
      expect(options.handleMentionSelect).not.toHaveBeenCalled();
      expect(options.handleSend).toHaveBeenCalledTimes(1);
    });

    it('a channel list is ignored in a DM composer', () => {
      const mentionHook = openChannelMentions(true);
      const { options, press } = setup({ isChannel: false, mentionHook });
      press({ key: 'Enter' });
      expect(mentionHook.handleKeyDown).not.toHaveBeenCalled();
      expect(options.handleSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('DM mention list (local)', () => {
    function applyUpdater(options: UseComposerKeysOptions, prev: SimpleMentionState) {
      const updater = vi.mocked(options.setDmMentionState).mock.calls[0][0] as (s: SimpleMentionState) => SimpleMentionState;
      return updater(prev);
    }

    it('ArrowDown moves the selection down, clamped at the last suggestion', () => {
      const { options, press } = setup({ isChannel: false, dmMentionState: openDm(0) });
      const { preventDefault } = press({ key: 'ArrowDown' });
      expect(preventDefault).toHaveBeenCalled();
      expect(applyUpdater(options, openDm(0)).selectedIndex).toBe(1);
      expect(applyUpdater(options, openDm(1)).selectedIndex).toBe(1);
    });

    it('ArrowUp moves the selection up, clamped at 0', () => {
      const { options, press } = setup({ isChannel: false, dmMentionState: openDm(1) });
      press({ key: 'ArrowUp' });
      expect(applyUpdater(options, openDm(1)).selectedIndex).toBe(0);
      expect(applyUpdater(options, openDm(0)).selectedIndex).toBe(0);
    });

    // Classic inserts in the list's own handler and again via
    // handleMentionSelect (which, for a DM, inserts the same suggestion).
    it.each(['Enter', 'Tab'])('%s inserts the selected suggestion, then also calls handleMentionSelect; no send', (key) => {
      const { options, press } = setup({ isChannel: false, dmMentionState: openDm(1) });
      const { preventDefault } = press({ key });
      expect(preventDefault).toHaveBeenCalled();
      expect(options.handleDmInsertMention).toHaveBeenCalledWith(bob);
      expect(options.handleMentionSelect).toHaveBeenCalledWith(1);
      expect(options.handleSend).not.toHaveBeenCalled();
    });

    it('Enter with the selection out of range inserts nothing and does not send', () => {
      const { options, press } = setup({ isChannel: false, dmMentionState: openDm(5) });
      press({ key: 'Enter' });
      expect(options.handleDmInsertMention).not.toHaveBeenCalled();
      expect(options.handleMentionSelect).not.toHaveBeenCalled();
      expect(options.handleSend).not.toHaveBeenCalled();
    });

    it('other keys fall through (typing goes on; Enter would send once closed)', () => {
      const { options, press } = setup({ isChannel: false, dmMentionState: openDm() });
      const { preventDefault } = press({ key: 'x' });
      expect(preventDefault).not.toHaveBeenCalled();
      expect(options.setDmMentionState).not.toHaveBeenCalled();
    });

    it('while closed, Enter sends', () => {
      const { options, press } = setup({ isChannel: false });
      press({ key: 'Enter' });
      expect(options.handleDmInsertMention).not.toHaveBeenCalled();
      expect(options.handleSend).toHaveBeenCalledTimes(1);
    });
  });
});
