/**
 * The desktop layout's global shortcuts, through ShortcutsProvider (which runs
 * useGlobalShortcuts): sidebar navigation, Esc, the shortcut sheet, and the
 * cases where they must stay out of the way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { ShortcutsProvider } from '../../components/Shortcuts/ShortcutsProvider';
import {
  useRegisterConversation,
  useRegisterSidebarNav,
  type ConversationTarget,
  type SidebarNav,
} from '../../contexts/ShortcutsContext';

const voice = vi.hoisted(() => ({ connected: false, ptt: false, key: 'Backquote' }));
vi.mock('../../contexts/VoiceContext', () => ({
  useVoice: () => ({ isConnected: voice.connected }),
}));
vi.mock('../../hooks/useVoiceSettings', () => ({
  useVoiceSettings: () => ({ isPushToTalk: voice.ptt, pushToTalkKey: voice.key }),
}));
const mockMarkRead = vi.fn();
vi.mock('../../utils/markConversationRead', () => ({
  markConversationRead: (...args: unknown[]) => mockMarkRead(...args),
}));

function Harness({ nav, conversation }: { nav: SidebarNav | null; conversation: ConversationTarget | null }) {
  useRegisterSidebarNav(nav);
  useRegisterConversation(conversation);
  return (
    <div>
      <input aria-label="Other field" />
      <div data-shortcut-scope="composer">
        <textarea aria-label="Composer" />
      </div>
      <button>Plain button</button>
    </div>
  );
}

function makeNav(overrides: Partial<SidebarNav> = {}): SidebarNav {
  return {
    kind: 'channel',
    items: [
      { id: 'a', label: '#alpha', unread: false },
      { id: 'b', label: '#beta', unread: false },
      { id: 'c', label: '#gamma', unread: true },
    ],
    currentId: 'a',
    select: vi.fn(),
    ...overrides,
  };
}

function setup(nav: SidebarNav | null = makeNav(), conversation: ConversationTarget | null = { kind: 'channel', id: 'a' }) {
  const utils = renderWithProviders(
    <ShortcutsProvider>
      <Harness nav={nav} conversation={conversation} />
    </ShortcutsProvider>,
  );
  return { ...utils, nav, conversation };
}

const announcer = () => screen.getByTestId('shortcut-announcer');

describe('useGlobalShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkRead.mockResolvedValue(true);
    voice.connected = false;
    voice.ptt = false;
    voice.key = 'Backquote';
  });

  it('Alt+↓ / Alt+↑ select the next / previous item and announce it', async () => {
    const { nav } = setup();
    expect(fireEvent.keyDown(document.body, { key: 'ArrowDown', altKey: true })).toBe(false);
    expect(nav!.select).toHaveBeenLastCalledWith('b');
    await waitFor(() => expect(announcer()).toHaveTextContent('#beta'));

    fireEvent.keyDown(document.body, { key: 'ArrowUp', altKey: true });
    expect(nav!.select).toHaveBeenLastCalledWith('c');
    await waitFor(() => expect(announcer()).toHaveTextContent('#gamma, unread'));
  });

  it('Alt+Shift+↓ jumps to the next unread item; with none it says so and stays', async () => {
    const { nav } = setup();
    fireEvent.keyDown(document.body, { key: 'ArrowDown', altKey: true, shiftKey: true });
    expect(nav!.select).toHaveBeenCalledWith('c');
  });

  it('announces when nothing is unread (DM wording)', async () => {
    const nav = makeNav({ kind: 'dm', items: [{ id: 'a', label: 'Alice', unread: false }, { id: 'b', label: 'Bob', unread: false }] });
    setup(nav);
    fireEvent.keyDown(document.body, { key: 'ArrowUp', altKey: true, shiftKey: true });
    expect(nav.select).not.toHaveBeenCalled();
    await waitFor(() => expect(announcer()).toHaveTextContent('No unread conversations'));
  });

  it('works from the main composer but not from other text fields', () => {
    const { nav } = setup();
    fireEvent.keyDown(screen.getByLabelText('Other field'), { key: 'ArrowDown', altKey: true });
    expect(nav!.select).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('Composer'), { key: 'ArrowDown', altKey: true });
    expect(nav!.select).toHaveBeenCalledWith('b');
  });

  it('leaves keys alone that something else handled, or while composing text (IME)', () => {
    const { nav } = setup();
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true });
    event.preventDefault();
    document.body.dispatchEvent(event);
    fireEvent.keyDown(document.body, { key: 'ArrowDown', altKey: true, isComposing: true });
    expect(nav!.select).not.toHaveBeenCalled();
  });

  it('gives way to the push-to-talk key while push-to-talk is live', () => {
    voice.connected = true;
    voice.ptt = true;
    voice.key = 'ArrowDown';
    const { nav } = setup();
    fireEvent.keyDown(document.body, { key: 'ArrowDown', code: 'ArrowDown', altKey: true });
    expect(nav!.select).not.toHaveBeenCalled();
  });

  it('Esc closes an open docked panel and does nothing else on that press', () => {
    const closeDockedPanel = vi.fn(() => true);
    setup(makeNav(), { kind: 'channel', id: 'a', closeDockedPanel });
    expect(fireEvent.keyDown(screen.getByLabelText('Composer'), { key: 'Escape' })).toBe(false);
    expect(closeDockedPanel).toHaveBeenCalledTimes(1);
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it('Esc with no panel open marks the conversation read', async () => {
    const closeDockedPanel = vi.fn(() => false);
    setup(makeNav(), { kind: 'dm', id: 'dm-1', closeDockedPanel });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(mockMarkRead).toHaveBeenCalledWith(expect.anything(), 'dm', 'dm-1');
    await waitFor(() => expect(announcer()).toHaveTextContent('Marked as read'));
  });

  it('Esc does nothing from other text fields or after a handler took it', () => {
    setup();
    fireEvent.keyDown(screen.getByLabelText('Other field'), { key: 'Escape' });
    const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it('Ctrl+/ toggles the shortcut sheet, even from a text field', async () => {
    setup();
    fireEvent.keyDown(screen.getByLabelText('Other field'), { key: '/', code: 'Slash', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(dialog).toHaveTextContent('Next unread channel or conversation');

    // Navigation keys stay off while the sheet (a modal) is open.
    fireEvent.keyDown(dialog, { key: 'ArrowDown', altKey: true });

    act(() => {
      fireEvent.keyDown(dialog, { key: '/', code: 'Slash', ctrlKey: true });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('stays off while another dialog is open', () => {
    const { nav } = setup();
    const modal = document.createElement('div');
    modal.className = 'MuiModal-root';
    document.body.appendChild(modal);
    try {
      fireEvent.keyDown(document.body, { key: 'ArrowDown', altKey: true });
      fireEvent.keyDown(document.body, { key: '/', code: 'Slash', ctrlKey: true });
      expect(nav!.select).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      modal.remove();
    }
  });

  it('does nothing when no list or conversation is registered', () => {
    setup(null, null);
    expect(fireEvent.keyDown(document.body, { key: 'ArrowDown', altKey: true })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(true);
  });
});
