/**
 * The Lounge's desktop shortcuts (PR 10e): Alt+↑/↓ and Alt+Shift+↑/↓ walk the community's text channels, Mod+/
 * toggles the shortcut sheet, and Escape marks the open channel read only when nothing else takes the key.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { ESCAPE_PRIORITY, KitProvider, useScreenEscape } from '../../../kit';
import { VoiceStateContext, type VoiceState } from '../../../contexts/VoiceContext';
import { VOICE_SETTINGS_KEY } from '../../../hooks/useVoiceSettings';
import { LoungeShortcuts, ShortcutSheet } from '../../../shell/lounge/frame/LoungeShortcuts';
import {
  channelsControllerFindAllForCommunityQueryKey,
  readReceiptsControllerGetUnreadCountsQueryKey,
} from '../../../api-client/@tanstack/react-query.gen';
import { createChannel, createTestQueryClient, renderWithProviders } from '../../test-utils';

const marked = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('../../../utils/markConversationRead', () => ({
  markConversationRead: async (...args: unknown[]) => {
    marked.calls.push(args.slice(1));
    return true;
  },
}));
vi.mock('../../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isMacPlatform: () => false,
}));

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

/** A screen's Escape step that takes the key (an open panel). */
function TakesEscape() {
  useScreenEscape(() => true, ESCAPE_PRIORITY.panel);
  return null;
}

function setup({ channelId = 'ch-b', extra, voice }: { channelId?: string | null; extra?: React.ReactNode; voice?: boolean } = {}) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(channelsControllerFindAllForCommunityQueryKey({ path: { communityId: 'c-1' } }), [
    createChannel({ id: 'ch-a', name: 'alpha', communityId: 'c-1', position: 0 }),
    createChannel({ id: 'ch-voice', name: 'hangout', communityId: 'c-1', type: 'VOICE', position: 1 }),
    createChannel({ id: 'ch-b', name: 'bravo', communityId: 'c-1', position: 2 }),
    createChannel({ id: 'ch-c', name: 'charlie', communityId: 'c-1', position: 3 }),
    createChannel({ id: 'ch-d', name: 'delta', communityId: 'c-1', position: 4 }),
  ]);
  queryClient.setQueryData(readReceiptsControllerGetUnreadCountsQueryKey(), [
    { channelId: 'ch-d', communityId: 'c-1', channelType: 'TEXT', unreadCount: 2, mentionCount: 0, lastReadMessageId: null },
  ]);
  return renderWithProviders(
    <VoiceStateContext.Provider value={voice ? ({ isConnected: true } as VoiceState) : null}>
    <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
      <input aria-label="a search field" />
      <div data-shortcut-scope="composer">
        <textarea aria-label="Message #bravo" />
      </div>
      {extra}
      <LoungeShortcuts communityId="c-1" channelId={channelId} />
      <Where />
    </KitProvider>
    </VoiceStateContext.Provider>,
    { queryClient, routerProps: { initialEntries: [`/community/c-1/channel/${channelId ?? ''}`] } },
  );
}

const where = () => screen.getByTestId('where').textContent;

describe('LoungeShortcuts', () => {
  beforeEach(() => {
    marked.calls = [];
    localStorage.clear();
  });

  /** Push-to-talk on `code`, in the saved voice settings. */
  const pushToTalkOn = (code: string) =>
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify({ inputMode: 'push_to_talk', pushToTalkKey: code, pushToTalkKeyDisplay: code }));

  it('Alt+↓ goes to the next text channel', async () => {
    setup();
    fireEvent.keyDown(document.body, { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(where()).toBe('/community/c-1/channel/ch-c'));
    expect(await screen.findByText('#charlie')).toBeInTheDocument();
  });

  it('Alt+↑ goes to the previous text channel (voice rooms are not in the walk)', async () => {
    setup();
    fireEvent.keyDown(document.body, { key: 'ArrowUp', altKey: true });
    await waitFor(() => expect(where()).toBe('/community/c-1/channel/ch-a'));
  });

  it('Alt+Shift+↓ goes to the next unread channel, past the read ones', async () => {
    setup();
    fireEvent.keyDown(document.body, { key: 'ArrowDown', altKey: true, shiftKey: true });
    await waitFor(() => expect(where()).toBe('/community/c-1/channel/ch-d'));
  });

  it('with no unread channel, Alt+Shift+↑ stays and announces "No unread channels"', async () => {
    setup({ channelId: 'ch-d' });
    fireEvent.keyDown(document.body, { key: 'ArrowUp', altKey: true, shiftKey: true });
    expect(await screen.findByText('No unread channels')).toBeInTheDocument();
    expect(where()).toBe('/community/c-1/channel/ch-d');
  });

  it('works from the channel composer, not from another field', async () => {
    setup();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'a search field' }), { key: 'ArrowDown', altKey: true });
    await act(async () => undefined);
    expect(where()).toBe('/community/c-1/channel/ch-b');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message #bravo' }), { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(where()).toBe('/community/c-1/channel/ch-c'));
  });

  it('Ctrl+/ opens the shortcut sheet, even from a field, and again closes it', async () => {
    setup();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message #bravo' }), { key: '/', ctrlKey: true });
    const sheet = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(sheet).getByText('Next unread channel or conversation')).toBeInTheDocument();
    expect(within(sheet).getByRole('img', { name: 'Alt plus Shift plus Down arrow' })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: '/', ctrlKey: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Escape marks the open channel read and says so', async () => {
    setup();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(marked.calls).toEqual([['channel', 'ch-b']]));
    expect(await screen.findByText('Marked as read')).toBeInTheDocument();
  });

  it('Escape marks nothing read when a screen step before it takes the key (an open panel)', async () => {
    setup({ extra: <TakesEscape /> });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await act(async () => undefined);
    expect(marked.calls).toEqual([]);
  });

  it('Escape that a field used (an edit, the mention list) marks nothing read', async () => {
    setup();
    const field = screen.getByRole('textbox', { name: 'a search field' });
    field.addEventListener('keydown', (event) => event.preventDefault());
    fireEvent.keyDown(field, { key: 'Escape' });
    await act(async () => undefined);
    expect(marked.calls).toEqual([]);
  });

  it('Escape with the shortcut sheet open closes it and marks nothing read', async () => {
    setup();
    fireEvent.keyDown(document.body, { key: '/', ctrlKey: true });
    await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(marked.calls).toEqual([]);
  });

  it('with no channel open (the inbox), Escape is left alone', async () => {
    setup({ channelId: null });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await act(async () => undefined);
    expect(marked.calls).toEqual([]);
  });

  it('the sheet shows the Mac keys on a Mac', () => {
    renderWithProviders(
      <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
        <ShortcutSheet open onClose={() => undefined} mac />
      </KitProvider>,
    );
    expect(screen.getByRole('img', { name: 'Command plus Slash' })).toHaveTextContent('⌘/');
  });

  it('the sheet lists "Edit your last message" with a keyboard, and not when touch-first', () => {
    const sheet = (touch: boolean) => (
      <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
        <ShortcutSheet open onClose={() => undefined} mac={false} touch={touch} />
      </KitProvider>
    );
    const { unmount } = renderWithProviders(sheet(false));
    expect(screen.getByText(/Edit your last message/)).toBeInTheDocument();
    unmount();
    renderWithProviders(sheet(true));
    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();
    expect(screen.queryByText(/Edit your last message/)).toBeNull();
    expect(screen.getByText('Next unread channel or conversation')).toBeInTheDocument();
  });

  describe('push-to-talk guard', () => {
    it('a push-to-talk key is not a shortcut, whatever modifiers are held, while in voice', async () => {
      pushToTalkOn('ArrowDown');
      setup({ voice: true });
      fireEvent.keyDown(document.body, { key: 'ArrowDown', code: 'ArrowDown', altKey: true });
      await act(async () => undefined);
      expect(where()).toBe('/community/c-1/channel/ch-b');
    });

    it('not connected to voice, the same key is still the shortcut', async () => {
      pushToTalkOn('ArrowDown');
      setup({ voice: false });
      fireEvent.keyDown(document.body, { key: 'ArrowDown', code: 'ArrowDown', altKey: true });
      await waitFor(() => expect(where()).toBe('/community/c-1/channel/ch-c'));
    });

    it('Escape as the push-to-talk key does not mark the channel read; another Escape does when it is not', async () => {
      pushToTalkOn('Escape');
      setup({ voice: true });
      fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
      await act(async () => undefined);
      expect(marked.calls).toEqual([]);
    });

    it('with another key as push-to-talk, Escape still marks read', async () => {
      pushToTalkOn('Backquote');
      setup({ voice: true });
      fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
      await waitFor(() => expect(marked.calls).toEqual([['channel', 'ch-b']]));
    });
  });
});
