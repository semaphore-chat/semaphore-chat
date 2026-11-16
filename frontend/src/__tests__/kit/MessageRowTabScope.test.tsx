import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Button, MessageRow, MessageText, ReactionChip, type MessageRowProps } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

const body = (
  <MessageText
    segments={[
      { type: 'text', text: 'see ' },
      { type: 'link', href: 'https://example.com/' },
      { type: 'mention', kind: 'user', text: '@aiko', id: 'u1' },
    ]}
    onMention={() => undefined}
  />
);

const row = (props: Partial<MessageRowProps> = {}) => (
  <MessageRow
    author="aiko"
    time="8:19 PM"
    body={body}
    reactions={<ReactionChip emoji="😂" label="Laugh" count={2} onToggle={() => undefined} />}
    footer={<Button onClick={() => undefined}>3 replies</Button>}
    onOpenAuthor={() => undefined}
    {...props}
  />
);

const innerControls = () => [
  screen.getByRole('link', { name: 'https://example.com/' }),
  screen.getByRole('button', { name: '@aiko' }),
  screen.getByRole('button', { name: 'Laugh reaction, 2' }),
  screen.getByRole('button', { name: '3 replies' }),
  screen.getByRole('button', { name: 'aiko' }),
];

describe('MessageRow and the list core', () => {
  it('marks itself as the roving focus target only when it joins a list', () => {
    const { rerender } = renderWithKit(row());
    expect(screen.getByRole('article')).not.toHaveAttribute('data-row-focus-target');
    rerender(row({ focus: { tabStop: true } }));
    expect(screen.getByRole('article')).toHaveAttribute('data-row-focus-target', 'true');
  });
});

describe('MessageRow: Tab inside a row (rowTabScope)', () => {
  it('a row outside a roving list keeps every inner control a natural Tab stop', () => {
    renderWithKit(row());
    for (const control of innerControls()) expect(control).not.toHaveAttribute('tabindex', '-1');
  });

  it('the list’s Tab stop row keeps its controls as Tab stops', () => {
    renderWithKit(row({ focus: { tabStop: true } }));
    for (const control of innerControls()) expect(control).not.toHaveAttribute('tabindex', '-1');
  });

  it('another row’s controls are out of the Tab order until focus is in that row, and again after it leaves', () => {
    renderWithKit(
      <>
        {row({ focus: { tabStop: false } })}
        <button type="button">outside</button>
      </>,
    );
    for (const control of innerControls()) expect(control).toHaveAttribute('tabindex', '-1');
    const article = screen.getByRole('article');
    fireEvent.focus(article);
    for (const control of innerControls()) expect(control).not.toHaveAttribute('tabindex', '-1');
    fireEvent.blur(article, { relatedTarget: screen.getByRole('button', { name: 'outside' }) });
    for (const control of innerControls()) expect(control).toHaveAttribute('tabindex', '-1');
  });

  it('moving focus between controls inside the row keeps them Tab stops', () => {
    renderWithKit(row({ focus: { tabStop: false } }));
    const [link, mention] = innerControls();
    fireEvent.focus(link);
    fireEvent.blur(link, { relatedTarget: mention });
    fireEvent.focus(mention);
    expect(link).not.toHaveAttribute('tabindex', '-1');
  });
});

describe('MessageRow: Enter opens the actions', () => {
  it('Enter on the row itself opens them as a keyboard request', () => {
    const onOpenActions = vi.fn();
    renderWithKit(row({ onOpenActions, focus: { tabStop: true } }));
    fireEvent.keyDown(screen.getByRole('article'), { key: 'Enter' });
    expect(onOpenActions).toHaveBeenCalledWith({ via: 'keyboard' });
  });

  it('Enter on a control inside the row is that control’s, and a modified or repeated Enter is not a request', () => {
    const onOpenActions = vi.fn();
    const onKeyDown = vi.fn();
    renderWithKit(row({ onOpenActions, focus: { tabStop: true, onKeyDown } }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Laugh reaction, 2' }), { key: 'Enter' });
    const article = screen.getByRole('article');
    fireEvent.keyDown(article, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(article, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(article, { key: 'Enter', repeat: true });
    expect(onOpenActions).not.toHaveBeenCalled();
    // Keys the row does not take go on to the list's roving focus.
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('without onOpenActions Enter is not taken: it reaches the list', () => {
    const onKeyDown = vi.fn();
    renderWithKit(row({ focus: { tabStop: true, onKeyDown } }));
    fireEvent.keyDown(screen.getByRole('article'), { key: 'Enter' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('a context menu right after an Enter request is not swallowed as its echo', () => {
    const onOpenActions = vi.fn();
    renderWithKit(row({ onOpenActions, focus: { tabStop: true } }));
    const article = screen.getByRole('article');
    fireEvent.keyDown(article, { key: 'Enter' });
    fireEvent.contextMenu(article);
    expect(onOpenActions).toHaveBeenCalledTimes(2);
  });
});
