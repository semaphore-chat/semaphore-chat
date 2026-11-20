/**
 * Kit additions for the community left island (PR 6): Stack `direction`/`fill`/`align`, Island `footer`
 * (and ThreeIslands `leftFooter`), the speaking avatar that no longer overlaps its neighbours, and the
 * ListRow trailing slot that gives way to a long name.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { AvatarStack, Island, ListRow, Pill, Stack, Text, ThreeIslands } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('Stack direction, fill and align', () => {
  it('a column by default, stretched', () => {
    renderWithKit(
      <Stack gap="md">
        <span>a</span>
      </Stack>,
    );
    const root = screen.getByText('a').parentElement!;
    expect(getComputedStyle(root).flexDirection).toBe('column');
    expect(getComputedStyle(root).alignItems).toBe('stretch');
    expect(getComputedStyle(root).gap).toBe(`${tokens.space.md}px`);
  });

  it('a row centres its children; a fill Stack takes the rest and may shrink, the others keep their size', () => {
    renderWithKit(
      <Stack direction="row" gap="sm">
        <span>fixed</span>
        <Stack gap="xs" fill>
          <Text truncate>long</Text>
        </Stack>
      </Stack>,
    );
    const row = screen.getByText('fixed').parentElement!;
    expect(getComputedStyle(row).flexDirection).toBe('row');
    expect(getComputedStyle(row).alignItems).toBe('center');
    expect(getComputedStyle(screen.getByText('fixed')).flexShrink).toBe('0');
    const fill = screen.getByText('long').parentElement!;
    expect(fill).toHaveAttribute('data-kit-stack-fill');
    expect(getComputedStyle(fill).flexGrow).toBe('1');
    expect(getComputedStyle(fill).minWidth).toBe('0px');
    expect(getComputedStyle(fill).flexShrink).not.toBe('0');
  });

  it('align start keeps a child its own width but never wider than the Stack', () => {
    renderWithKit(
      <div data-testid="wrap">
        <Stack gap="xs" align="start">
          <Pill size="sm">You're here</Pill>
        </Stack>
      </div>,
    );
    const root = screen.getByTestId('wrap').firstElementChild!;
    expect(getComputedStyle(root).alignItems).toBe('flex-start');
  });
});

describe('Island footer', () => {
  it('without a footer the children sit directly in the island, which scrolls', () => {
    renderWithKit(
      <Island as="nav" label="Couch Co-op" scroll>
        <span>body</span>
      </Island>,
    );
    const nav = screen.getByRole('navigation', { name: 'Couch Co-op' });
    expect(screen.getByText('body').parentElement).toBe(nav);
    expect(getComputedStyle(nav).overflowY).toBe('auto');
  });

  it('with a footer only the body scrolls; the footer is after it, inside the landmark, and never scrolls', () => {
    renderWithKit(
      <Island as="nav" label="Couch Co-op" scroll footer={<span>card</span>}>
        <span>body</span>
      </Island>,
    );
    const nav = screen.getByRole('navigation', { name: 'Couch Co-op' });
    const body = screen.getByText('body').parentElement!;
    const foot = screen.getByText('card').parentElement!;
    expect(getComputedStyle(nav).overflowY).not.toBe('auto');
    expect(getComputedStyle(body).overflowY).toBe('auto');
    expect(getComputedStyle(foot).overflowY).not.toBe('auto');
    expect(getComputedStyle(foot).flexShrink).toBe('0');
    expect(body.nextElementSibling).toBe(foot);
    expect(nav.contains(foot)).toBe(true);
  });

  it('ThreeIslands puts leftFooter at the left island foot; the call bar stays outside, under the island', () => {
    renderWithKit(
      <ThreeIslands
        left={<span>channels</span>}
        leftFooter={<span>user card</span>}
        leftLabel="Couch Co-op"
        centre={null}
        centreLabel="general"
        callBar={<span>call bar</span>}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Couch Co-op' });
    expect(nav.contains(screen.getByText('user card'))).toBe(true);
    expect(nav.contains(screen.getByText('call bar'))).toBe(false);
    // Reading order: the island (with its footer) before the call bar
    expect(nav.compareDocumentPosition(screen.getByText('call bar')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('AvatarStack speaker spacing', () => {
  it('a speaker and the avatar after it do not overlap; the others overlap as before', () => {
    renderWithKit(
      <AvatarStack people={[{ name: 'dropbear', speaking: true }, { name: 'pri' }, { name: 'alexk' }]} />,
    );
    const slots = Array.from(screen.getByRole('img', { name: /dropbear is talking/ }).children) as HTMLElement[];
    expect(getComputedStyle(slots[1]).marginLeft).toBe(`${tokens.border.selected * 2}px`);
    expect(getComputedStyle(slots[2]).marginLeft).toBe(`-${tokens.space.sm}px`);
  });

  it('a speaker in the middle sits apart from the one before too', () => {
    renderWithKit(<AvatarStack people={[{ name: 'pri' }, { name: 'dropbear', speaking: true }, { name: 'alexk' }]} />);
    const slots = Array.from(screen.getByRole('img', { name: /dropbear is talking/ }).children) as HTMLElement[];
    expect(getComputedStyle(slots[1]).marginLeft).toBe(`${tokens.border.selected * 2}px`);
    expect(getComputedStyle(slots[2]).marginLeft).toBe(`${tokens.border.selected * 2}px`);
  });
});

describe('ListRow trailing slot', () => {
  it('takes at most half the row and does not shrink below its content otherwise, so a long Pill cuts and a short one stays whole', () => {
    renderWithKit(<ListRow primary="Samira" trailing={<Pill size="sm">Server administrator</Pill>} />);
    const pill = screen.getByText('Server administrator').closest('span:not(:empty)')!;
    let slot = pill as HTMLElement;
    while (slot.parentElement && getComputedStyle(slot).maxWidth !== '50%') slot = slot.parentElement;
    expect(getComputedStyle(slot).maxWidth).toBe('50%');
    expect(getComputedStyle(slot).minWidth).toBe('0px');
    expect(getComputedStyle(slot).flexShrink).toBe('0');
  });
});
