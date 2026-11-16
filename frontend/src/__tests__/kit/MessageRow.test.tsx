import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { MessageRow, type MessageRowProps } from '../../kit';
import { LONG_PRESS_MS } from '../../kit/chat/MessageRow';
import { renderWithKit } from '../test-utils/renderWithKit';
import { expectNoAxeViolations, runAxe } from '../test-utils/a11y';

const row = (props: Partial<MessageRowProps> = {}) => (
  <MessageRow author="aiko" time="8:19 PM" timeLabel="Monday 16 November 2026, 8:19 PM" body={<p>hello</p>} {...props} />
);

afterEach(() => {
  vi.useRealTimers();
});

describe('MessageRow', () => {
  it('shows the name and time on the first row of a group, and is an article named by them', () => {
    renderWithKit(row({ dateTime: '2026-11-16T20:19:00Z' }));
    const article = screen.getByRole('article', { name: /aiko 8:19 PM/ });
    expect(article).toHaveTextContent('hello');
    expect(screen.getByText('8:19 PM').closest('time')).toHaveAttribute('dateTime', '2026-11-16T20:19:00Z');
  });

  it('a continued row draws no name, but is still named by its author', () => {
    const { container } = renderWithKit(row({ continued: true }));
    expect(screen.getByRole('article', { name: /aiko/ })).toBeInTheDocument();
    // The only avatar-sized thing is the gutter time, hidden from assistive technology.
    expect(container.querySelector('[data-reveal]')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('the name opens the profile when onOpenAuthor is given; the avatar is a pointer shortcut out of the Tab order', () => {
    const onOpenAuthor = vi.fn();
    const { container } = renderWithKit(row({ onOpenAuthor }));
    fireEvent.click(screen.getByRole('button', { name: 'aiko' }));
    const avatar = container.querySelector('button[aria-hidden="true"]') as HTMLButtonElement;
    expect(avatar).toHaveAttribute('tabindex', '-1');
    fireEvent.click(avatar);
    expect(onOpenAuthor).toHaveBeenCalledTimes(2);
  });

  it('marks edited and pinned', () => {
    renderWithKit(row({ edited: true, pinned: true }));
    expect(screen.getByText('(edited)')).toBeInTheDocument();
    expect(screen.getByText('Pinned')).toBeInTheDocument();
  });

  it('pending is busy and says "Sending…"', () => {
    renderWithKit(row({ state: 'pending' }));
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Sending…')).toBeInTheDocument();
  });

  it('failed says "Not sent" with Retry and Delete when given', () => {
    const onRetry = vi.fn();
    const onDelete = vi.fn();
    renderWithKit(row({ state: 'failed', onRetry, onDelete }));
    expect(screen.getByText('Not sent')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('draws its slots in order: quote, body, attachments, reactions, footer', () => {
    renderWithKit(
      row({
        quote: <span>Q</span>,
        body: <span>B</span>,
        attachments: <span>A</span>,
        reactions: <span>R</span>,
        footer: <span>F</span>,
      }),
    );
    expect(screen.getByRole('article').textContent?.replace(/.*8:19 PM, Monday 16 November 2026, 8:19 PM/, '')).toBe('QBARF');
  });

  it('joins the roving focus: tabStop sets tabindex 0, others -1, and passes keys and focus through', () => {
    const onKeyDown = vi.fn();
    const onFocus = vi.fn();
    const { rerender } = renderWithKit(row({ focus: { tabStop: true, onKeyDown, onFocus } }));
    const article = screen.getByRole('article');
    expect(article).toHaveAttribute('tabindex', '0');
    fireEvent.focus(article);
    fireEvent.keyDown(article, { key: 'ArrowUp' });
    expect(onFocus).toHaveBeenCalled();
    expect(onKeyDown).toHaveBeenCalled();
    rerender(row({ focus: { tabStop: false } }));
    expect(screen.getByRole('article')).toHaveAttribute('tabindex', '-1');
  });

  it('opens the actions on right-click (suppressing the native menu) and on the context-menu key or Shift+F10', () => {
    const onOpenActions = vi.fn();
    const onKeyDown = vi.fn();
    renderWithKit(row({ onOpenActions, focus: { tabStop: true, onKeyDown } }));
    const article = screen.getByRole('article');
    expect(fireEvent.contextMenu(article)).toBe(false);
    expect(onOpenActions).toHaveBeenLastCalledWith('pointer');
    fireEvent.keyDown(article, { key: 'ContextMenu' });
    fireEvent.keyDown(article, { key: 'F10', shiftKey: true });
    expect(onOpenActions).toHaveBeenCalledTimes(3);
    expect(onOpenActions).toHaveBeenLastCalledWith('keyboard');
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('leaves the native menu alone without onOpenActions', () => {
    renderWithKit(row());
    expect(fireEvent.contextMenu(screen.getByRole('article'))).toBe(true);
  });

  it('opens the actions on a touch long press, once, and not when the finger moves or lifts early', () => {
    vi.useFakeTimers();
    const onOpenActions = vi.fn();
    renderWithKit(row({ onOpenActions }));
    const article = screen.getByRole('article');
    const touch = { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 };

    fireEvent.pointerDown(article, touch);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(onOpenActions).toHaveBeenCalledWith('touch');
    // Android's context menu after the same long press does not open them again.
    fireEvent.contextMenu(article);
    expect(onOpenActions).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(article, touch);
    fireEvent.pointerMove(article, { ...touch, clientY: 40 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    fireEvent.pointerDown(article, touch);
    fireEvent.pointerUp(article, touch);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(onOpenActions).toHaveBeenCalledTimes(1);

    // A mouse press is not a long press.
    fireEvent.pointerDown(article, { ...touch, pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(onOpenActions).toHaveBeenCalledTimes(1);
  });

  it('puts the actions in a named toolbar', () => {
    renderWithKit(row({ actions: <button type="button">Reply</button> }));
    expect(screen.getByRole('toolbar', { name: "Actions for aiko's message" })).toContainElement(
      screen.getByRole('button', { name: 'Reply' }),
    );
  });

  it('has no axe violations, first of a group, continued and failed', async () => {
    const { container } = renderWithKit(
      <div role="list">
        <div role="listitem">{row({ onOpenAuthor: vi.fn(), mentioned: true, pinned: true, actions: <button type="button">Reply</button> })}</div>
        <div role="listitem">{row({ continued: true, highlighted: true })}</div>
        <div role="listitem">{row({ state: 'failed', onRetry: vi.fn(), onDelete: vi.fn() })}</div>
      </div>,
    );
    expectNoAxeViolations(await runAxe(container));
  });
});
