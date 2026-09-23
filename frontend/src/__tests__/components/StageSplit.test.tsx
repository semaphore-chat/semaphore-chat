import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, act } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { StageSplit } from '../../components/Voice/StageSplit';
import { getCachedItem } from '../../utils/storage';

const STORAGE_KEY = 'semaphore_dm_stage_ratio_test';

// Container is 0..200 in the y axis for every test in this file.
function mockContainerRect() {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    bottom: 200,
    height: 200,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON() {},
  });
}

function dragDivider(divider: Element, fromY: number, toY: number) {
  fireEvent.pointerDown(divider, { pointerId: 1, clientY: fromY });
  act(() => {
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientY: toY }));
  });
}

function releasePointer(atY: number) {
  act(() => {
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientY: atY }));
  });
}

describe('StageSplit', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders top and bottom children', () => {
    renderWithProviders(
      <StageSplit storageKey={STORAGE_KEY} top={<div>TOP CONTENT</div>} bottom={<div>BOTTOM CONTENT</div>} />
    );

    expect(screen.getByText('TOP CONTENT')).toBeInTheDocument();
    expect(screen.getByText('BOTTOM CONTENT')).toBeInTheDocument();
  });

  it('seeds the ratio from storage, clamped to [minRatio, maxRatio]', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(0.7));

    renderWithProviders(
      <StageSplit storageKey={STORAGE_KEY} top={<div>TOP</div>} bottom={<div>BOTTOM</div>} />
    );

    expect(screen.getByTestId('stage-split-top')).toHaveStyle({ flexBasis: '70%' });
  });

  it('falls back to defaultRatio when nothing is cached', () => {
    renderWithProviders(
      <StageSplit storageKey={STORAGE_KEY} top={<div>TOP</div>} bottom={<div>BOTTOM</div>} defaultRatio={0.4} />
    );

    expect(screen.getByTestId('stage-split-top')).toHaveStyle({ flexBasis: '40%' });
  });

  it('clamps a seeded ratio outside [minRatio, maxRatio] on read', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(0.95));

    renderWithProviders(
      <StageSplit storageKey={STORAGE_KEY} top={<div>TOP</div>} bottom={<div>BOTTOM</div>} minRatio={0.2} maxRatio={0.8} />
    );

    expect(screen.getByTestId('stage-split-top')).toHaveStyle({ flexBasis: '80%' });
  });

  it('pointer-drag on the divider changes the top pane flexBasis', () => {
    mockContainerRect();
    renderWithProviders(
      <StageSplit storageKey={STORAGE_KEY} top={<div>TOP</div>} bottom={<div>BOTTOM</div>} />
    );

    const divider = screen.getByTestId('stage-split-divider');
    dragDivider(divider, 100, 150);

    // container height 200, pointer at y=150 -> ratio 0.75
    expect(screen.getByTestId('stage-split-top')).toHaveStyle({ flexBasis: '75%' });

    releasePointer(150);
  });

  it('clamps the ratio at minRatio/maxRatio while dragging past the bounds', () => {
    mockContainerRect();
    renderWithProviders(
      <StageSplit
        storageKey={STORAGE_KEY}
        top={<div>TOP</div>}
        bottom={<div>BOTTOM</div>}
        minRatio={0.2}
        maxRatio={0.8}
      />
    );

    const divider = screen.getByTestId('stage-split-divider');

    // Drag far past the bottom of the container -> clamps to maxRatio.
    dragDivider(divider, 100, 1000);
    expect(screen.getByTestId('stage-split-top')).toHaveStyle({ flexBasis: '80%' });
    releasePointer(1000);

    // Drag far above the top of the container -> clamps to minRatio.
    dragDivider(divider, 100, -1000);
    expect(screen.getByTestId('stage-split-top')).toHaveStyle({ flexBasis: '20%' });
    releasePointer(-1000);
  });

  it('persists the ratio to storage on pointer-up only, not during move', () => {
    mockContainerRect();
    renderWithProviders(
      <StageSplit storageKey={STORAGE_KEY} top={<div>TOP</div>} bottom={<div>BOTTOM</div>} />
    );

    const divider = screen.getByTestId('stage-split-divider');
    dragDivider(divider, 100, 150);

    // Mid-drag: the DOM has updated but nothing should be written to storage yet.
    expect(getCachedItem<number>(STORAGE_KEY)).toBeNull();

    releasePointer(150);

    // After release: the final ratio is persisted.
    expect(getCachedItem<number>(STORAGE_KEY)).toBeCloseTo(0.75);
  });

  it('exposes separator semantics with aria values reflecting the current ratio', () => {
    renderWithProviders(
      <StageSplit
        storageKey={STORAGE_KEY}
        top={<div>TOP</div>}
        bottom={<div>BOTTOM</div>}
        defaultRatio={0.5}
        minRatio={0.2}
        maxRatio={0.8}
      />
    );

    const divider = screen.getByTestId('stage-split-divider');
    expect(divider).toHaveAttribute('role', 'separator');
    expect(divider).toHaveAttribute('aria-orientation', 'horizontal');
    expect(divider).toHaveAttribute('aria-label', 'Resize video area');
    expect(divider).toHaveAttribute('aria-valuenow', '50');
    expect(divider).toHaveAttribute('aria-valuemin', '20');
    expect(divider).toHaveAttribute('aria-valuemax', '80');
    expect(divider).toHaveAttribute('tabIndex', '0');
  });

  it('updates aria-valuenow after a drag', () => {
    mockContainerRect();
    renderWithProviders(
      <StageSplit storageKey={STORAGE_KEY} top={<div>TOP</div>} bottom={<div>BOTTOM</div>} />
    );

    const divider = screen.getByTestId('stage-split-divider');
    dragDivider(divider, 100, 150);
    expect(divider).toHaveAttribute('aria-valuenow', '75');
    releasePointer(150);
  });

  it('ArrowDown increases the top-pane ratio by 0.05 and persists it', () => {
    renderWithProviders(
      <StageSplit storageKey={STORAGE_KEY} top={<div>TOP</div>} bottom={<div>BOTTOM</div>} defaultRatio={0.5} />
    );

    const divider = screen.getByTestId('stage-split-divider');
    fireEvent.keyDown(divider, { key: 'ArrowDown' });

    expect(screen.getByTestId('stage-split-top')).toHaveStyle({ flexBasis: '55%' });
    expect(divider).toHaveAttribute('aria-valuenow', '55');
    expect(getCachedItem<number>(STORAGE_KEY)).toBeCloseTo(0.55);
  });

  it('ArrowUp decreases the top-pane ratio by 0.05 and persists it', () => {
    renderWithProviders(
      <StageSplit storageKey={STORAGE_KEY} top={<div>TOP</div>} bottom={<div>BOTTOM</div>} defaultRatio={0.5} />
    );

    const divider = screen.getByTestId('stage-split-divider');
    fireEvent.keyDown(divider, { key: 'ArrowUp' });

    expect(screen.getByTestId('stage-split-top')).toHaveStyle({ flexBasis: '45%' });
    expect(divider).toHaveAttribute('aria-valuenow', '45');
    expect(getCachedItem<number>(STORAGE_KEY)).toBeCloseTo(0.45);
  });

  it('clamps ArrowDown/ArrowUp at maxRatio/minRatio', () => {
    renderWithProviders(
      <StageSplit
        storageKey={STORAGE_KEY}
        top={<div>TOP</div>}
        bottom={<div>BOTTOM</div>}
        defaultRatio={0.78}
        minRatio={0.2}
        maxRatio={0.8}
      />
    );

    const divider = screen.getByTestId('stage-split-divider');
    fireEvent.keyDown(divider, { key: 'ArrowDown' });
    expect(screen.getByTestId('stage-split-top')).toHaveStyle({ flexBasis: '80%' });
    expect(getCachedItem<number>(STORAGE_KEY)).toBeCloseTo(0.8);

    // Drive it all the way down to minRatio and confirm it clamps there too.
    for (let i = 0; i < 20; i++) {
      fireEvent.keyDown(divider, { key: 'ArrowUp' });
    }
    expect(screen.getByTestId('stage-split-top')).toHaveStyle({ flexBasis: '20%' });
    expect(getCachedItem<number>(STORAGE_KEY)).toBeCloseTo(0.2);
  });
});
