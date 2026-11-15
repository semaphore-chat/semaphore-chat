import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen, within } from '@testing-library/react';
import { AppFrame, IconButton, StageLayout, type StageLayoutProps } from '../../../kit';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { WIDTH, mockViewport } from './matchMedia';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

function renderStage(props: Partial<StageLayoutProps> = {}) {
  return renderWithKit(
    <AppFrame>
      <StageLayout
        header={<h1>Squad Up</h1>}
        stage={<div data-testid="stage">Screen share</div>}
        controls={<IconButton icon="Mic" label="Mute" />}
        stageLabel="Squad Up stage"
        {...props}
      />
    </AppFrame>,
  );
}

describe.each([
  ['phone', WIDTH.phone],
  ['compact', WIDTH.compact],
  ['wide', WIDTH.wide],
])('StageLayout at %s', (_name, width) => {
  beforeEach(() => {
    mockViewport(width);
  });

  it('is one main named stageLabel holding header, stage and controls', () => {
    renderStage();
    const main = screen.getByRole('main', { name: 'Squad Up stage' });
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(within(main).getByRole('heading', { name: 'Squad Up' })).toBeInTheDocument();
    expect(within(main).getByTestId('stage')).toBeInTheDocument();
    expect(within(main).getByRole('button', { name: 'Mute' })).toBeInTheDocument();
  });

  it('keeps header, stage, strip and controls in reading order', () => {
    renderStage({ strip: <p>Tiles</p> });
    const order = ['Squad Up', 'Screen share', 'Tiles'].map((text) => screen.getByText(text));
    order.push(screen.getByRole('button', { name: 'Mute' }));
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('leaves no strip element without a strip', () => {
    renderStage();
    expect(screen.getByRole('main').querySelector('[data-slot="strip"]')).toBeNull();
  });

  it('renders the strip when given', () => {
    renderStage({ strip: <p>Tiles</p> });
    expect(screen.getByText('Tiles').closest('[data-slot="strip"]')).not.toBeNull();
  });

  it('shows no dialog until sideOpen, then the side in a dialog named sideLabel', () => {
    const { rerender } = renderStage({ side: <p>People list</p>, sideLabel: 'People' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('People list')).toBeNull();
    rerender(
      <AppFrame>
        <StageLayout
          header={<h1>Squad Up</h1>}
          stage={<div data-testid="stage">Screen share</div>}
          controls={<IconButton icon="Mic" label="Mute" />}
          stageLabel="Squad Up stage"
          side={<p>People list</p>}
          sideLabel="People"
          sideOpen
        />
      </AppFrame>,
    );
    expect(within(screen.getByRole('dialog', { name: 'People' })).getByText('People list')).toBeInTheDocument();
  });

  it('Escape calls onSideClose', async () => {
    const onSideClose = vi.fn();
    const { user } = renderStage({ side: <p>People list</p>, sideLabel: 'People', sideOpen: true, onSideClose });
    await user.keyboard('{Escape}');
    expect(onSideClose).toHaveBeenCalledTimes(1);
  });

  it('has no dialog without a side', () => {
    renderStage({ sideOpen: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
