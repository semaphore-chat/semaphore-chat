import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, screen } from '@testing-library/react';
import { Badge, Icon, IconButton, ListRow, Pill, Text, useListFocus } from '../../kit';
import { derivePalette } from '../../theme/derive/derivePalette';
import { parseHex } from '../../theme/derive/oklch';
import { renderWithKit } from '../test-utils/renderWithKit';
import { rulesFor } from './cssRules';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('ListRow', () => {
  it('with href is a link named by its primary line', () => {
    renderWithKit(<ListRow primary="general" href="/c/general" />);
    const link = screen.getByRole('link', { name: 'general' });
    expect(link).toHaveAttribute('href', '/c/general');
  });

  it('with onClick is a button that fires on click and on Enter', async () => {
    const onClick = vi.fn();
    const { user } = renderWithKit(<ListRow primary="general" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'general' });
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    button.focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('with neither is plain content: no button, no link', () => {
    renderWithKit(<ListRow primary="general" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('general')).toBeInTheDocument();
  });

  it('selected exposes aria-current: page for a link, true for a button', () => {
    const { rerender } = renderWithKit(<ListRow primary="a" href="/a" selected />);
    expect(screen.getByRole('link', { name: 'a' })).toHaveAttribute('aria-current', 'page');
    rerender(<ListRow primary="a" onClick={() => undefined} selected />);
    expect(screen.getByRole('button', { name: 'a' })).toHaveAttribute('aria-current', 'true');
  });

  it('is not current when not selected', () => {
    renderWithKit(<ListRow primary="a" href="/a" />);
    expect(screen.getByRole('link', { name: 'a' })).not.toHaveAttribute('aria-current');
  });

  it('disabled blocks activation of a button', async () => {
    const onClick = vi.fn();
    const { user } = renderWithKit(<ListRow primary="a" onClick={onClick} disabled />);
    await user.click(screen.getByRole('button', { name: 'a' }));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'a' })).toBeDisabled();
  });

  it('disabled link is not navigable', async () => {
    const { user } = renderWithKit(<ListRow primary="a" href="/a" disabled />);
    const link = screen.queryByRole('link', { name: 'a' });
    expect(link === null || !link.hasAttribute('href')).toBe(true);
    await user.tab();
    expect(screen.getByText('a').closest('a')).not.toBe(document.activeElement);
  });

  it('renders the secondary line, the leading and the trailing slot', () => {
    renderWithKit(
      <ListRow
        primary="aiko"
        secondary="Playing Hades"
        leading={<Icon name="Hash" label="channel" />}
        trailing={<IconButton icon="Ellipsis" label="More" />}
        href="/u/aiko"
      />,
    );
    expect(screen.getByText('Playing Hades')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'channel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('a trailing IconButton is a separate tab stop and does not trigger the row', async () => {
    const onRow = vi.fn();
    const onMore = vi.fn();
    const { user } = renderWithKit(
      <ListRow
        primary="aiko"
        onClick={onRow}
        trailing={<IconButton icon="Ellipsis" label="More" onClick={onMore} />}
      />,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'aiko' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'More' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(onMore).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
    // Valid HTML: no interactive element inside another.
    expect(screen.getByRole('button', { name: 'aiko' }).querySelector('button, a')).toBeNull();
  });

  it('unread is heavier than read', () => {
    renderWithKit(
      <>
        <ListRow primary="read one" />
        <ListRow primary="unread one" unread />
      </>,
    );
    const read = Number(getComputedStyle(screen.getByText('read one')).fontWeight);
    const unread = Number(getComputedStyle(screen.getByText('unread one')).fontWeight);
    expect(unread).toBeGreaterThan(read);
  });

  it('forwards id and ref to the interactive element', () => {
    const ref = { current: null as HTMLElement | null };
    renderWithKit(<ListRow primary="a" onClick={() => undefined} id="row-a" ref={ref} />);
    expect(screen.getByRole('button', { name: 'a' })).toHaveAttribute('id', 'row-a');
    expect(ref.current).toBe(screen.getByRole('button', { name: 'a' }));
  });
});

const palette = derivePalette('#8E75FF', 'dark', 'minimal');
const rgb = (hex: string) => `rgb(${parseHex(hex).join(', ')})`;

describe('ListRow hit area', () => {
  // jsdom has no layout, so these pin the mechanism: a stretched pseudo-element on the
  // row's own link or button, and a pressed tint that only that element can trigger.
  it('the link or button stretches over the whole row', () => {
    renderWithKit(<ListRow primary="a" onClick={() => undefined} trailing={<IconButton icon="Ellipsis" label="More" />} />);
    const main = screen.getByRole('button', { name: 'a' });
    const stretch = rulesFor(main, '::after').filter((rule) => rule.style.position === 'absolute');
    expect(stretch.length).toBeGreaterThan(0);
  });

  it('the pressed tint belongs to the row button, never to the wrapper, so a trailing control does not press the row', () => {
    renderWithKit(<ListRow primary="a" onClick={() => undefined} trailing={<IconButton icon="Ellipsis" label="More" />} />);
    const main = screen.getByRole('button', { name: 'a' });
    const wrapper = main.parentElement as HTMLElement;
    expect(rulesFor(wrapper, ':active')).toHaveLength(0);
    expect(rulesFor(main, ':active::after').length).toBeGreaterThan(0);
  });

  it('the trailing slot sits above the stretched element', () => {
    renderWithKit(<ListRow primary="a" onClick={() => undefined} trailing={<IconButton icon="Ellipsis" label="More" />} />);
    const trailing = screen.getByRole('button', { name: 'More' }).parentElement as HTMLElement;
    expect(getComputedStyle(trailing).position).toBe('relative');
  });

  it('a plain row has no stretched element', () => {
    renderWithKit(<ListRow primary="a" />);
    const plain = screen.getByText('a').closest('div') as HTMLElement;
    expect(rulesFor(plain, '::after')).toHaveLength(0);
  });
});

describe('ListRow motion', () => {
  it('its background transition is off under reduced motion', () => {
    renderWithKit(<ListRow primary="a" onClick={() => undefined} />);
    const wrapper = screen.getByRole('button', { name: 'a' }).parentElement as HTMLElement;
    const calm = rulesFor(wrapper, '').filter((rule) => rule.parentRule !== null && /prefers-reduced-motion/.test(rule.parentRule.cssText.slice(0, 80)));
    expect(calm.some((rule) => rule.style.transition.startsWith('none'))).toBe(true);
  });
});

describe('ListRow selected: kit children read on the accent pill', () => {
  const trailing = (
    <>
      <Icon name="Bell" tone="secondary" label="bell" />
      <Text tone="secondary">text</Text>
      <IconButton icon="Ellipsis" label="More" />
      <IconButton icon="Pin" label="Pin" variant="soft" />
      <Badge count={3} label="3 unread" tone="accent" />
      <Pill tone="accent">New</Pill>
    </>
  );

  it('uses on-accent ink for icons, text and ghost or soft icon buttons', () => {
    renderWithKit(<ListRow primary="a" onClick={() => undefined} selected trailing={trailing} />);
    expect(screen.getByRole('img', { name: 'bell' })).toHaveStyle({ color: rgb(palette.onAccent) });
    expect(screen.getByText('text')).toHaveStyle({ color: rgb(palette.onAccent) });
    expect(screen.getByRole('button', { name: 'More' })).toHaveStyle({ color: rgb(palette.onAccent) });
    expect(screen.getByRole('button', { name: 'Pin' })).toHaveStyle({ color: rgb(palette.onAccent) });
  });

  it('inverts the Badge and the accent Pill: on-accent background, accent text', () => {
    renderWithKit(<ListRow primary="a" onClick={() => undefined} selected trailing={trailing} />);
    expect(screen.getByRole('img', { name: '3 unread' })).toHaveStyle({
      background: rgb(palette.onAccent),
      color: rgb(palette.accent),
    });
    expect(screen.getByText('New').parentElement).toHaveStyle({
      background: rgb(palette.onAccent),
      color: rgb(palette.accent),
    });
  });

  it('leaves the same children alone on an unselected row', () => {
    renderWithKit(<ListRow primary="a" onClick={() => undefined} trailing={trailing} />);
    expect(screen.getByRole('img', { name: 'bell' })).toHaveStyle({ color: rgb(palette.textSecondary) });
    expect(screen.getByText('text')).toHaveStyle({ color: rgb(palette.textSecondary) });
    expect(screen.getByRole('img', { name: '3 unread' })).toHaveStyle({ background: rgb(palette.accent) });
  });

  it('does not leak: a sibling row that is not selected keeps default ink', () => {
    renderWithKit(
      <>
        <ListRow primary="a" selected trailing={<Text tone="secondary">in selected</Text>} />
        <ListRow primary="b" trailing={<Text tone="secondary">in other</Text>} />
      </>,
    );
    expect(screen.getByText('in other')).toHaveStyle({ color: rgb(palette.textSecondary) });
  });
});

describe('ListRow in a keyboard list (focus)', () => {
  function InList(props: { disabled?: boolean; href?: string; plain?: boolean; onRef?: (element: HTMLElement | null) => void; keyboard?: boolean }) {
    const list = useListFocus({ rows: [{ id: 'a', label: 'Alpha', disabled: props.disabled === true }], selected: null });
    const kind = props.plain ? {} : props.href !== undefined ? { href: props.href } : { onClick: () => {} };
    return (
      <div {...list.listProps}>
        <ListRow
          primary="Alpha"
          disabled={props.disabled}
          ref={props.onRef}
          {...kind}
          focus={props.keyboard === false ? undefined : list.rowFocus('a')}
          trailing={<IconButton icon="Ellipsis" label="More" onClick={() => {}} />}
        />
      </div>
    );
  }

  it('a disabled link row stays unfocusable (no tabindex)', () => {
    renderWithKit(<InList href="#a" disabled />);
    expect(screen.getByRole('link', { name: 'Alpha' })).not.toHaveAttribute('tabindex');
  });

  it('a plain row ignores focus: it does not become a focusable element with no role', () => {
    renderWithKit(<InList plain />);
    expect(screen.getByText('Alpha').closest('[tabindex]')).toBeNull();
  });

  it('the trailing controls go back into the Tab order when the row leaves the list', () => {
    const { rerender } = renderWithKit(<InList />);
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('tabindex', '-1');
    rerender(<InList keyboard={false} />);
    expect(screen.getByRole('button', { name: 'More' })).not.toHaveAttribute('tabindex', '-1');
  });

  it('a trailing control that sets its own tabindex later is taken out again', async () => {
    renderWithKit(<InList />);
    const more = screen.getByRole('button', { name: 'More' });
    more.setAttribute('tabindex', '0');
    await act(async () => {});
    expect(more).toHaveAttribute('tabindex', '-1');
  });

  it('does not detach and re-attach the ref on every render', () => {
    const onRef = vi.fn();
    const { rerender } = renderWithKit(<InList onRef={onRef} />);
    rerender(<InList onRef={onRef} />);
    rerender(<InList onRef={onRef} />);
    expect(onRef.mock.calls.filter(([element]) => element === null)).toHaveLength(0);
  });
});
