/**
 * The left island is never rebuilt across widths (review I1). The frame passes the user card as ThreeIslands'
 * `leftFooter` at compact and wide and nothing at phone; the island keeps one structure either way. A mount counter
 * proves the content mounts once while the width goes wide → compact → phone → wide, and the island's scroll
 * position, focus in the channel list, an open community menu and a pending Join survive every crossing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useEffect, type JSX } from 'react';
import { act, screen, within } from '@testing-library/react';
import { ThreeIslands, useWidthRange } from '../../../kit';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { CommunityLeftView } from '../../../shell/lounge/pieces/community/CommunityLeft';
import { VoiceRoomCard } from '../../../shell/lounge/pieces/community/VoiceRoomCard';
import { UserCard } from '../../../shell/lounge/pieces/community/UserCard';

/** A matchMedia that answers the kit's two queries for a width the test sets, and tells listeners when it changes. */
function installWidth(initial: number) {
  let width = initial;
  const lists: { query: string; listeners: Set<() => void> }[] = [];
  const min = (query: string) => Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
  window.matchMedia = ((query: string) => {
    const entry = { query, listeners: new Set<() => void>() };
    lists.push(entry);
    return {
      get matches() {
        return width >= min(query);
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => entry.listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => entry.listeners.delete(fn),
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return (next: number) => {
    width = next;
    act(() => lists.forEach((entry) => entry.listeners.forEach((fn) => fn())));
  };
}

const mounts = { count: 0 };
function Counted({ children }: { children: JSX.Element }) {
  useEffect(() => {
    mounts.count += 1;
  }, []);
  return children;
}

const noop = () => undefined;
const ready = { status: 'ready' as const, error: null, retryable: true, refreshByUser: false, refresh: noop, retry: noop };
const channels = Array.from({ length: 40 }, (_, i) => ({
  id: `ch-${i}`,
  name: `channel-${i}`,
  unread: false,
  mentions: 0,
  isPrivate: false,
  announcement: false,
}));

/** The frame's rule: the user card at compact and wide, nothing at phone. */
function Frame() {
  const range = useWidthRange();
  return (
    <ThreeIslands
      left={
        <Counted>
          <CommunityLeftView
            access="ok"
            header={{ name: 'Couch Co-op', aroundCount: 9, actions: ['settings'], onAction: noop }}
            channels={{ channels, selectedId: 'ch-0', hrefFor: (id) => `#${id}`, state: ready }}
            rooms={[
              <VoiceRoomCard
                key="squad"
                name="Squad Up"
                people={[]}
                youId="me"
                speaking={new Set()}
                youAreHere={false}
                canJoin
                joining
                onJoin={noop}
                onLeave={noop}
              />,
            ]}
            onLeave={noop}
          />
        </Counted>
      }
      leftFooter={range === 'phone' ? undefined : <UserCard name="alexk" online line={null} call={null} onSettings={noop} />}
      leftLabel="Couch Co-op"
      centre={null}
      centreLabel="general"
      phonePane="left"
    />
  );
}

const original = window.matchMedia;
beforeEach(() => {
  mounts.count = 0;
});
afterEach(() => {
  window.matchMedia = original;
});

describe('the left island across widths', () => {
  it('mounts once wide → compact → phone → wide; scroll, focus, an open menu and a pending Join survive', async () => {
    const setWidth = installWidth(1300);
    const { user } = renderWithKit(<Frame />);
    const nav = screen.getByRole('navigation', { name: 'Couch Co-op' });
    const body = nav.firstElementChild as HTMLElement;
    body.scrollTop = 120;
    await user.click(screen.getByRole('button', { name: 'Couch Co-op, community menu' }));
    expect(screen.getByRole('menu', { name: 'Couch Co-op menu' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'channel-5', hidden: true });
    expect(screen.getByRole('button', { name: 'Join Squad Up', hidden: true })).toHaveAttribute('aria-busy', 'true');
    expect(within(nav).getByRole('button', { name: 'Settings', hidden: true })).toBeInTheDocument();

    for (const [width, footer] of [
      [900, true],
      [390, false],
      [1300, true],
    ] as const) {
      setWidth(width);
      expect(mounts.count).toBe(1);
      expect(screen.getByRole('navigation', { name: 'Couch Co-op', hidden: true }).firstElementChild).toBe(body);
      expect(body.scrollTop).toBe(120);
      expect(screen.getByRole('menu', { name: 'Couch Co-op menu' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'channel-5', hidden: true })).toBe(link);
      expect(screen.getByRole('button', { name: 'Join Squad Up', hidden: true })).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByRole('button', { name: 'Settings', hidden: true }) !== null).toBe(footer);
    }
  });

  it('focus inside the channel list stays on its row across a crossing', () => {
    const setWidth = installWidth(1300);
    renderWithKit(<Frame />);
    const link = screen.getByRole('link', { name: 'channel-3' });
    act(() => link.focus());
    setWidth(900);
    expect(document.activeElement).toBe(link);
    setWidth(1300);
    expect(document.activeElement).toBe(link);
  });
});
