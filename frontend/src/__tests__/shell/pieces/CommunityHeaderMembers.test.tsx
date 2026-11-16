/**
 * The community header's members button (PR 9b): "N around" opens the frame's members while they are not on
 * screen beside the list, and the kit Sheet a phone shows them in returns focus to it on close. With the
 * members island shown at wide the line is plain text.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState, type JSX } from 'react';
import { screen } from '@testing-library/react';
import { ThreeIslands } from '../../../kit';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { CommunityHeader } from '../../../shell/lounge/pieces/community/CommunityHeader';
import { membersButtonText } from '../../../shell/lounge/pieces/community/lines';

const noop = () => undefined;

/** A matchMedia that answers the kit's width queries for one fixed width. */
function installWidth(width: number) {
  const min = (query: string) => Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
  window.matchMedia = ((query: string) =>
    ({
      matches: width >= min(query),
      media: query,
      addEventListener: noop,
      removeEventListener: noop,
      addListener: noop,
      removeListener: noop,
      onchange: null,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
});

describe('the header members button', () => {
  it('"N around" is a button that opens the members when they are not on screen', async () => {
    const onShowMembers = vi.fn();
    const { user } = renderWithKit(
      <CommunityHeader name="Couch Co-op" aroundCount={12} actions={[]} onAction={noop} onShowMembers={onShowMembers} />,
    );
    const button = screen.getByRole('button', { name: '12 around, show members' });
    expect(button).toHaveTextContent('12 around');
    await user.click(button);
    expect(onShowMembers).toHaveBeenCalledTimes(1);
  });

  it('with no count the button says Members', () => {
    renderWithKit(<CommunityHeader name="Couch Co-op" aroundCount={null} actions={[]} onAction={noop} onShowMembers={noop} />);
    expect(screen.getByRole('button', { name: 'Members' })).toHaveTextContent('Members');
    expect(membersButtonText(null)).toEqual({ text: 'Members', label: 'Members' });
    expect(membersButtonText(1200)).toEqual({ text: '1,200 around', label: '1,200 around, show members' });
  });

  it('at wide with the island shown the line is plain text', () => {
    renderWithKit(
      <CommunityHeader name="Couch Co-op" aroundCount={12} actions={[]} onAction={noop} onShowMembers={noop} membersShown />,
    );
    expect(screen.getByText('12 around')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /around/ })).toBeNull();
  });

  it('without a way to show the members (no handler) the line stays plain text', () => {
    renderWithKit(<CommunityHeader name="Couch Co-op" aroundCount={3} actions={[]} onAction={noop} />);
    expect(screen.getByText('3 around')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('on a phone the button opens the members Sheet, and closing it returns focus to the button', async () => {
    installWidth(390);
    function PhoneHome(): JSX.Element {
      const [open, setOpen] = useState(false);
      return (
        <ThreeIslands
          left={<CommunityHeader name="Couch Co-op" aroundCount={12} actions={[]} onAction={noop} onShowMembers={() => setOpen(true)} />}
          leftLabel="Community"
          centre={null}
          centreLabel="Couch Co-op"
          right={<p>The member list</p>}
          rightLabel="Members"
          rightOpen={open}
          onRightClose={() => setOpen(false)}
          phonePane="left"
        />
      );
    }
    const { user } = renderWithKit(<PhoneHome />);
    const button = screen.getByRole('button', { name: '12 around, show members' });
    await user.click(button);
    const sheet = await screen.findByRole('dialog', { name: 'Members' });
    expect(sheet).toHaveTextContent('The member list');
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Members' })).toBeNull());
    await vi.waitFor(() => expect(button).toHaveFocus());
  });
});
