import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { PickerGrid, type PickerGridSection } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';
import { expectNoAxeViolations, runAxe } from '../test-utils/a11y';

const sections: PickerGridSection[] = [
  { id: 'recent', title: 'Recently used', items: [{ id: 'r1', label: 'thumbs up', glyph: '👍' }] },
  {
    id: 'custom',
    title: 'Custom',
    items: [
      { id: 'c1', label: ':parrot:', src: 'data:image/png;base64,AA==' },
      { id: 'c2', label: ':blob:', src: 'data:image/png;base64,AA==' },
    ],
  },
];

describe('PickerGrid', () => {
  it('names the grid and each section, and each cell by its label', () => {
    renderWithKit(<PickerGrid label="Emoji" sections={sections} onPick={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Emoji' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Recently used' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'thumbs up' })).toHaveTextContent('👍');
    const img = screen.getByRole('button', { name: ':parrot:' }).querySelector('img');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('alt', '');
  });

  it('is one Tab stop; the arrows move focus across sections and Enter picks', async () => {
    const onPick = vi.fn();
    const { user } = renderWithKit(
      <>
        <button type="button">before</button>
        <PickerGrid label="Emoji" sections={sections} onPick={onPick} />
      </>,
    );
    const tabbable = screen.getAllByRole('button').filter((b) => b.tabIndex === 0);
    expect(tabbable.map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual(['before', '👍']);
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'thumbs up' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: ':parrot:' })).toHaveFocus();
    expect(screen.getByRole('button', { name: ':parrot:' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: 'thumbs up' })).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: ':blob:' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('button', { name: 'thumbs up' })).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}{Enter}');
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'c2' }), 'custom');
  });

  it('keeps a Tab stop when the sections shrink under the focused cell', () => {
    const { rerender } = renderWithKit(<PickerGrid label="Emoji" sections={sections} onPick={vi.fn()} />);
    fireEvent.focus(screen.getByRole('button', { name: ':blob:' }));
    rerender(<PickerGrid label="Emoji" sections={[sections[0]]} onPick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'thumbs up' })).toHaveAttribute('tabindex', '0');
  });

  it('asks for more when focus reaches the last row', async () => {
    const loadMore = vi.fn();
    const { user } = renderWithKit(
      <PickerGrid label="GIFs" variant="media" sections={[sections[1]]} onPick={vi.fn()} loadMore={loadMore} />,
    );
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(loadMore).toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const { container } = renderWithKit(<PickerGrid label="Emoji" sections={sections} onPick={vi.fn()} />);
    expectNoAxeViolations(await runAxe(container));
  });
});
