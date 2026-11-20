import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createEvent, fireEvent, screen } from '@testing-library/react';
import { MessageRow, type MessageRowProps } from '../../kit';
import { createPortal } from 'react-dom';
import { GHOST_CLICK_MS, LONG_PRESS_MS } from '../../kit/chat/MessageRow';
import { renderWithKit } from '../test-utils/renderWithKit';
import { expectNoAxeViolations, runAxe } from '../test-utils/a11y';
import { rawCssFor } from './cssRules';

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

  it('failed shows its reason in place of "Not sent" when given', () => {
    renderWithKit(row({ state: 'failed', failedReason: 'Timed out until 8:40 PM' }));
    expect(screen.getByText('Timed out until 8:40 PM')).toBeInTheDocument();
    expect(screen.queryByText('Not sent')).toBeNull();
  });

  it('while retrying, Retry is busy: aria-busy and aria-disabled, still focusable, presses ignored', () => {
    const onRetry = vi.fn();
    renderWithKit(row({ state: 'failed', retrying: true, onRetry }));
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(retry).not.toBeDisabled();
    retry.focus();
    expect(retry).toHaveFocus();
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
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

  it('opens the actions on right-click at the cursor (suppressing the native menu), and on the context-menu key or Shift+F10', () => {
    const onOpenActions = vi.fn();
    const onKeyDown = vi.fn();
    renderWithKit(row({ onOpenActions, focus: { tabStop: true, onKeyDown } }));
    const article = screen.getByRole('article');
    fireEvent.pointerDown(article, { pointerId: 1, pointerType: 'mouse', button: 2, clientX: 40, clientY: 60 });
    expect(fireEvent.contextMenu(article, { clientX: 40, clientY: 60 })).toBe(false);
    expect(onOpenActions).toHaveBeenLastCalledWith({ via: 'pointer', x: 40, y: 60 });
    fireEvent.keyDown(article, { key: 'ContextMenu' });
    expect(onOpenActions).toHaveBeenLastCalledWith({ via: 'keyboard' });
    fireEvent.keyDown(article, { key: 'F10', shiftKey: true });
    expect(onOpenActions).toHaveBeenCalledTimes(3);
    expect(onOpenActions).toHaveBeenLastCalledWith({ via: 'keyboard' });
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it("keeps a Windows right-click's pointer for its context menu, which comes after the button is up", () => {
    const onOpenActions = vi.fn();
    renderWithKit(row({ onOpenActions }));
    const article = screen.getByRole('article');
    const right = { pointerId: 1, pointerType: 'mouse', button: 2, clientX: 5, clientY: 7 };
    fireEvent.pointerDown(article, right);
    fireEvent.pointerUp(article, right);
    fireEvent.contextMenu(article, { clientX: 5, clientY: 7 });
    expect(onOpenActions).toHaveBeenCalledWith({ via: 'pointer', x: 5, y: 7 });
  });

  it('a context menu no pointer made (the Menu key reaching the browser, VoiceOver\'s VO+Shift+M) is a keyboard request', () => {
    const onOpenActions = vi.fn();
    renderWithKit(row({ onOpenActions }));
    const article = screen.getByRole('article');
    // No pointer went down on the row.
    expect(fireEvent.contextMenu(article, { clientX: 0, clientY: 0 })).toBe(false);
    expect(onOpenActions).toHaveBeenLastCalledWith({ via: 'keyboard' });
    // A pointer went down earlier and was lifted: its context menu was used up, so this one is the keyboard's.
    fireEvent.pointerDown(article, { pointerId: 1, pointerType: 'mouse', button: 0 });
    fireEvent.pointerUp(article, { pointerId: 1, pointerType: 'mouse', button: 0 });
    fireEvent.contextMenu(article);
    expect(onOpenActions).toHaveBeenLastCalledWith({ via: 'keyboard' });
    // A browser that says so (a PointerEvent context menu with no pointer type) wins over a pointer still down.
    fireEvent.pointerDown(article, { pointerId: 1, pointerType: 'mouse', button: 2 });
    const event = createEvent.contextMenu(article);
    Object.defineProperty(event, 'pointerType', { value: '' });
    fireEvent(article, event);
    expect(onOpenActions).toHaveBeenLastCalledWith({ via: 'keyboard' });
    expect(onOpenActions).toHaveBeenCalledTimes(3);
  });

  it('opens once when the context-menu key also raises a context menu', () => {
    const onOpenActions = vi.fn();
    renderWithKit(row({ onOpenActions, focus: { tabStop: true } }));
    const article = screen.getByRole('article');
    fireEvent.keyDown(article, { key: 'ContextMenu' });
    expect(fireEvent.contextMenu(article)).toBe(false);
    expect(onOpenActions).toHaveBeenCalledTimes(1);
    expect(onOpenActions).toHaveBeenCalledWith({ via: 'keyboard' });
  });

  it('leaves the native menu alone without onOpenActions', () => {
    renderWithKit(row());
    expect(fireEvent.contextMenu(screen.getByRole('article'))).toBe(true);
  });

  it("leaves a field's own context menu (paste, select) alone, by mouse or by touch", () => {
    const onOpenActions = vi.fn();
    renderWithKit(row({ onOpenActions, body: <textarea aria-label="Edit message" /> }));
    const field = screen.getByRole('textbox');
    fireEvent.pointerDown(field, { pointerId: 1, pointerType: 'mouse', button: 2 });
    expect(fireEvent.contextMenu(field)).toBe(true);
    fireEvent.pointerDown(field, { pointerId: 2, pointerType: 'touch' });
    expect(fireEvent.contextMenu(field)).toBe(true);
    expect(onOpenActions).not.toHaveBeenCalled();
  });

  it('opens the actions on a touch long press at the finger, once, and not when the finger moves or lifts early', () => {
    vi.useFakeTimers();
    const onOpenActions = vi.fn();
    renderWithKit(row({ onOpenActions }));
    const article = screen.getByRole('article');
    const touch = { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 12 };

    fireEvent.pointerDown(article, touch);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(onOpenActions).toHaveBeenCalledWith({ via: 'touch', x: 10, y: 12 });
    // Android's context menu after the same long press does not open them again.
    expect(fireEvent.contextMenu(article)).toBe(false);
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

  it("an Android long press whose context menu comes first opens once, at the press's start", () => {
    vi.useFakeTimers();
    const onOpenActions = vi.fn();
    renderWithKit(row({ onOpenActions }));
    const article = screen.getByRole('article');
    fireEvent.pointerDown(article, { pointerId: 1, pointerType: 'touch', clientX: 3, clientY: 4 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS - 50));
    expect(fireEvent.contextMenu(article, { clientX: 99, clientY: 99 })).toBe(false);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(onOpenActions).toHaveBeenCalledTimes(1);
    expect(onOpenActions).toHaveBeenCalledWith({ via: 'touch', x: 3, y: 4 });
  });

  it('swallows the click a fired long press leaves behind (iOS), so the reaction under the finger is not pressed', () => {
    vi.useFakeTimers();
    const onOpenActions = vi.fn();
    const onToggle = vi.fn();
    renderWithKit(row({ onOpenActions, body: <span>hold here</span>, reactions: <button type="button" onClick={onToggle}>Laugh</button> }));
    const article = screen.getByRole('article');
    const chip = screen.getByRole('button', { name: 'Laugh' });
    const touch = { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 };

    fireEvent.pointerDown(screen.getByText('hold here'), touch);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    fireEvent.pointerUp(article, touch);
    // iOS raises no context menu, but a click lands where the finger lifted.
    fireEvent.click(chip);
    expect(onOpenActions).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();

    // The next press is a press again.
    fireEvent.pointerDown(chip, touch);
    fireEvent.pointerUp(chip, touch);
    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('a press is a press again once the ghost-click window after a long press ends (keyboard, screen reader)', () => {
    vi.useFakeTimers();
    const onOpenActions = vi.fn();
    const onToggle = vi.fn();
    renderWithKit(row({ onOpenActions, body: <span>hold here</span>, reactions: <button type="button" onClick={onToggle}>Laugh</button> }));
    const article = screen.getByRole('article');
    const touch = { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 };
    fireEvent.pointerDown(screen.getByText('hold here'), touch);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    fireEvent.pointerUp(article, touch);
    // No ghost click came (Android). Later, Enter on the reaction (a click with no pointer) toggles it.
    act(() => vi.advanceTimersByTime(GHOST_CLICK_MS));
    fireEvent.click(screen.getByRole('button', { name: 'Laugh' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    // And a screen reader's "show menu" on the row opens the actions.
    expect(fireEvent.contextMenu(article)).toBe(false);
    expect(onOpenActions).toHaveBeenCalledTimes(2);
    expect(onOpenActions).toHaveBeenLastCalledWith({ via: 'keyboard' });
  });

  it('ignores pointer, context-menu and click events from a portalled menu or picker opened from a slot', () => {
    vi.useFakeTimers();
    const onOpenActions = vi.fn();
    const onPick = vi.fn();
    const Picker = () =>
      createPortal(
        <div>
          <textarea aria-label="Search emoji" />
          <button type="button" onClick={onPick}>
            Skin tone
          </button>
        </div>,
        document.body,
      );
    renderWithKit(row({ onOpenActions, body: <span>hold here</span>, reactions: <Picker /> }));
    const article = screen.getByRole('article');
    const search = screen.getByRole('textbox', { name: 'Search emoji' });
    const item = screen.getByRole('button', { name: 'Skin tone' });
    expect(article.contains(item)).toBe(false);

    // Right-click in the picker's field: the paste menu stays, the row's actions do not open.
    fireEvent.pointerDown(search, { pointerId: 1, pointerType: 'mouse', button: 2 });
    expect(fireEvent.contextMenu(search)).toBe(true);
    // Right-click on a menu item.
    fireEvent.pointerDown(item, { pointerId: 1, pointerType: 'mouse', button: 2 });
    expect(fireEvent.contextMenu(item)).toBe(true);
    // Holding an emoji (a skin-tone hold) is not a long press on the row.
    const touch = { pointerId: 2, pointerType: 'touch', clientX: 5, clientY: 5 };
    fireEvent.pointerDown(item, touch);
    expect(article).not.toHaveAttribute('data-pressing');
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    fireEvent.pointerUp(item, touch);
    expect(onOpenActions).not.toHaveBeenCalled();

    // After a long press on the row, a click in the picker is the picker's, not swallowed.
    fireEvent.pointerDown(screen.getByText('hold here'), touch);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    fireEvent.pointerUp(article, touch);
    fireEvent.click(item);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onOpenActions).toHaveBeenCalledTimes(1);
  });

  it('does not start a long press on a link, button or field inside the row, and leaves their touch menu native', () => {
    vi.useFakeTimers();
    const onOpenActions = vi.fn();
    renderWithKit(
      row({
        onOpenActions,
        body: (
          <p>
            <a href="https://example.com">a link</a> <textarea aria-label="Edit" />
          </p>
        ),
        reactions: <button type="button">Laugh</button>,
      }),
    );
    const touch = { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 };
    for (const target of [screen.getByRole('link'), screen.getByRole('button', { name: 'Laugh' }), screen.getByRole('textbox')]) {
      fireEvent.pointerDown(target, touch);
      act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
      // Android's long press on a link raises a context menu: copy the link is the browser's.
      expect(fireEvent.contextMenu(target)).toBe(true);
      fireEvent.pointerUp(target, touch);
    }
    expect(onOpenActions).not.toHaveBeenCalled();
    // A mouse right-click on a link inside the row is still the row's menu (as classic).
    const link = screen.getByRole('link');
    fireEvent.pointerDown(link, { pointerId: 2, pointerType: 'mouse', button: 2, clientX: 1, clientY: 2 });
    expect(fireEvent.contextMenu(link, { clientX: 1, clientY: 2 })).toBe(false);
    expect(onOpenActions).toHaveBeenCalledWith({ via: 'pointer', x: 1, y: 2 });
  });

  it('turns off the iOS callout and text selection only while a finger is held down (guard: reads the CSS rule)', () => {
    vi.useFakeTimers();
    renderWithKit(row({ onOpenActions: vi.fn() }));
    const article = screen.getByRole('article');
    expect(article).not.toHaveAttribute('data-pressing');
    expect(getComputedStyle(article).userSelect).not.toBe('none');
    fireEvent.pointerDown(article, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
    expect(article).toHaveAttribute('data-pressing');
    expect(rawCssFor(article)).toMatch(/\[data-pressing\]\{[^}]*-webkit-touch-callout:none;[^}]*user-select:none/);
    fireEvent.pointerUp(article, { pointerId: 1, pointerType: 'touch' });
    expect(article).not.toHaveAttribute('data-pressing');
    // A mouse press never marks it: message text stays selectable on a desktop.
    fireEvent.pointerDown(article, { pointerId: 2, pointerType: 'mouse', button: 0 });
    expect(article).not.toHaveAttribute('data-pressing');
  });

  it('puts the actions in a named toolbar that is not there at rest, and is while focus is in the row', () => {
    renderWithKit(row({ actions: <button type="button">Reply</button>, focus: { tabStop: true } }));
    const name = "Actions for aiko's message";
    // visibility: hidden, so it is out of the accessibility tree and Tab order, not just transparent.
    expect(screen.queryByRole('toolbar', { name })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
    screen.getByRole('article').focus();
    expect(screen.getByRole('toolbar', { name })).toContainElement(screen.getByRole('button', { name: 'Reply' }));
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
