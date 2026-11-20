/**
 * Re-render churn (review M3): a change to one community's counts re-renders that community's dock item only.
 * The kit's DockItem is wrapped to count its renders per community.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { ShellDock, type ShellDockProps } from '../../../shell/lounge/pieces/ShellDock';
import { sampleCommunities } from '../../../stories/fixtures/loungeCommunities';

const renders = vi.hoisted(() => new Map<string, number>());
vi.mock('../../../kit', async (importOriginal) => {
  const kit = await importOriginal<typeof import('../../../kit')>();
  const { DockItem } = kit;
  return {
    ...kit,
    DockItem: (props: Parameters<typeof DockItem>[0]) => {
      renders.set(props.name, (renders.get(props.name) ?? 0) + 1);
      return <DockItem {...props} />;
    },
  };
});

const noop = () => undefined;

function props(communities: ShellDockProps['communities']): ShellDockProps {
  return { communities, current: { kind: 'community', id: 'c-1' }, inboxCount: 3, status: 'ready', onOpenInbox: noop, onOpenAll: noop, bottomBar: false };
}

beforeEach(() => renders.clear());

describe('ShellDock re-renders', () => {
  it('one community gaining a mention re-renders that item only, of sixty', () => {
    const first = sampleCommunities(60);
    const { rerender } = renderWithKit(<ShellDock {...props(first)} />);
    renders.clear();
    // A new list (as the connected dock builds on every unread change) with one community's count changed
    const next = first.map((community) => (community.id === 'c-3' ? { ...community, mentions: 2 } : { ...community }));
    rerender(<ShellDock {...props(next)} inboxCount={4} />);
    expect([...renders.entries()]).toEqual([['Lumen Studio', 1]]);
  });
});
