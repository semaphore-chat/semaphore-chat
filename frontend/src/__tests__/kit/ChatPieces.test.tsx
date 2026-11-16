import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { JumpToLatest, ListSeparator, ReactionChip } from '../../kit';
import { drawnReactionCount } from '../../kit/chat/reactionCount';
import { renderWithKit } from '../test-utils/renderWithKit';
import { expectNoAxeViolations, runAxe } from '../test-utils/a11y';

describe('ListSeparator', () => {
  it('is a separator named by its label, in both variants', async () => {
    const { container } = renderWithKit(
      <>
        <ListSeparator variant="day" label="Today" />
        <ListSeparator variant="unread" label="New" />
      </>,
    );
    expect(screen.getByRole('separator', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'New' })).toBeInTheDocument();
    expectNoAxeViolations(await runAxe(container));
  });
});

describe('ReactionChip', () => {
  it('is a toggle named "<label> reaction, <count>", pressed when mine', () => {
    const { rerender } = renderWithKit(<ReactionChip emoji="😂" label="Laugh" count={4} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Laugh reaction, 4' })).toHaveAttribute('aria-pressed', 'false');
    rerender(<ReactionChip emoji="😂" label="Laugh" count={5} mine onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Laugh reaction, 5' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles on press, and ignores presses while unavailable or busy (but stays focusable)', () => {
    const onToggle = vi.fn();
    const { rerender } = renderWithKit(<ReactionChip emoji="👍" label="Thumbs up" count={1} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<ReactionChip emoji="👍" label="Thumbs up" count={1} aria-disabled onToggle={onToggle} />);
    const unavailable = screen.getByRole('button');
    expect(unavailable).toHaveAttribute('aria-disabled', 'true');
    expect(unavailable).not.toBeDisabled();
    fireEvent.click(unavailable);

    rerender(<ReactionChip emoji="👍" label="Thumbs up" count={1} busy onToggle={onToggle} />);
    const busy = screen.getByRole('button');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    busy.focus();
    expect(busy).toHaveFocus();
    fireEvent.click(busy);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('draws counts up to 999 in full and compact above, while the name keeps the exact count', () => {
    renderWithKit(<ReactionChip emoji="🔥" label="Fire" count={1250} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Fire reaction, 1250' })).toHaveTextContent('1.3K');
    expect(drawnReactionCount(999)).toBe('999');
    expect(drawnReactionCount(-3)).toBe('0');
    expect(drawnReactionCount(Number.NaN)).toBe('0');
  });

  it('shows a custom emoji image, and its fallback text when the image fails', () => {
    const { container } = renderWithKit(
      <ReactionChip emoji=":parrot:" src="https://example.com/p.png" label="parrot" count={2} onToggle={vi.fn()} />,
    );
    const image = container.querySelector('img') as HTMLImageElement;
    expect(image).toHaveAttribute('alt', '');
    fireEvent.error(image);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'parrot reaction, 2' })).toHaveTextContent(':parrot:');
  });

  it('has no axe violations', async () => {
    const { container } = renderWithKit(<ReactionChip emoji="😂" label="Laugh" count={4} mine onToggle={vi.fn()} />);
    expectNoAxeViolations(await runAxe(container));
  });
});

describe('JumpToLatest', () => {
  it('is named "Jump to latest", and with a count says how many are new', () => {
    const { rerender } = renderWithKit(<JumpToLatest onJump={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toHaveTextContent('Jump to latest');
    rerender(<JumpToLatest onJump={vi.fn()} newCount={1} />);
    expect(screen.getByRole('button', { name: 'Jump to latest, 1 new message' })).toHaveTextContent('1 new');
    rerender(<JumpToLatest onJump={vi.fn()} newCount={3} />);
    expect(screen.getByRole('button', { name: 'Jump to latest, 3 new messages' })).toHaveTextContent('3 new');
    rerender(<JumpToLatest onJump={vi.fn()} newCount={240} />);
    expect(screen.getByRole('button', { name: 'Jump to latest, 99+ new messages' })).toHaveTextContent('99+ new');
    rerender(<JumpToLatest onJump={vi.fn()} newCount={0} />);
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeInTheDocument();
  });

  it('jumps on press, and while busy stays focusable and ignores presses', () => {
    const onJump = vi.fn();
    const { rerender } = renderWithKit(<JumpToLatest onJump={onJump} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onJump).toHaveBeenCalledTimes(1);
    rerender(<JumpToLatest onJump={onJump} busy />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('has no axe violations', async () => {
    const { container } = renderWithKit(<JumpToLatest onJump={vi.fn()} newCount={3} />);
    expectNoAxeViolations(await runAxe(container));
  });
});
