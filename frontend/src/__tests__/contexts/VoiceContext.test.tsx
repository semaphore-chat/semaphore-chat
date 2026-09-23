import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  VoiceProvider,
  useVoice,
  useVoiceDispatch,
  VoiceActionType,
} from '../../contexts/VoiceContext';
import { VideoLayoutMode } from '../../types/videoLayout';
import { getCachedItem, setCachedItem } from '../../utils/storage';
import { defaultPlacement, isValidPlacement, type PipPlacement } from '../../utils/pipPosition';

function TestConsumer() {
  const { stageMounted, showVideoTiles, pipCollapsed, isConnected, layoutMode, pinnedTileId, spotlightTileId } = useVoice();
  const { dispatch } = useVoiceDispatch();

  return (
    <div>
      <span data-testid="stage-mounted">{String(stageMounted)}</span>
      <span data-testid="show-video-tiles">{String(showVideoTiles)}</span>
      <span data-testid="pip-collapsed">{String(pipCollapsed)}</span>
      <span data-testid="is-connected">{String(isConnected)}</span>
      <span data-testid="layout-mode">{layoutMode}</span>
      <span data-testid="pinned-tile-id">{String(pinnedTileId)}</span>
      <span data-testid="spotlight-tile-id">{String(spotlightTileId)}</span>
      <button
        onClick={() => dispatch({ type: VoiceActionType.SetStageMounted, payload: true })}
      >
        Mount Stage
      </button>
      <button
        onClick={() => dispatch({ type: VoiceActionType.SetStageMounted, payload: false })}
      >
        Unmount Stage
      </button>
      <button onClick={() => dispatch({ type: VoiceActionType.SetShowVideoTiles, payload: true })}>
        Show Video Tiles
      </button>
      <button onClick={() => dispatch({ type: VoiceActionType.SetPipCollapsed, payload: true })}>
        Collapse Pip
      </button>
      <button onClick={() => dispatch({ type: VoiceActionType.SetPipCollapsed, payload: false })}>
        Expand Pip
      </button>
      <button onClick={() => dispatch({ type: VoiceActionType.SetDisconnected })}>
        Disconnect
      </button>
      <button onClick={() => dispatch({ type: VoiceActionType.SetLayoutMode, payload: VideoLayoutMode.Grid })}>
        Set Grid
      </button>
      <button onClick={() => dispatch({ type: VoiceActionType.SetLayoutMode, payload: VideoLayoutMode.Sidebar })}>
        Set Sidebar
      </button>
      <button onClick={() => dispatch({ type: VoiceActionType.SetLayoutMode, payload: VideoLayoutMode.Spotlight })}>
        Set Spotlight
      </button>
      <button onClick={() => dispatch({ type: VoiceActionType.TogglePinTile, payload: 'tile-a' })}>
        Toggle Pin A
      </button>
      <button onClick={() => dispatch({ type: VoiceActionType.TogglePinTile, payload: 'tile-b' })}>
        Toggle Pin B
      </button>
      <button onClick={() => dispatch({ type: VoiceActionType.ToggleSpotlightTile, payload: 'tile-a' })}>
        Toggle Spotlight A
      </button>
      <button onClick={() => dispatch({ type: VoiceActionType.ToggleSpotlightTile, payload: 'tile-b' })}>
        Toggle Spotlight B
      </button>
    </div>
  );
}

describe('VoiceContext reducer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stageMounted defaults to false', () => {
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    expect(screen.getByTestId('stage-mounted')).toHaveTextContent('false');
  });

  it('SetStageMounted(true) sets stageMounted to true', async () => {
    const user = userEvent.setup();
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    await user.click(screen.getByText('Mount Stage'));

    expect(screen.getByTestId('stage-mounted')).toHaveTextContent('true');
  });

  it('SetStageMounted(false) sets stageMounted back to false', async () => {
    const user = userEvent.setup();
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    await user.click(screen.getByText('Mount Stage'));
    expect(screen.getByTestId('stage-mounted')).toHaveTextContent('true');

    await user.click(screen.getByText('Unmount Stage'));
    expect(screen.getByTestId('stage-mounted')).toHaveTextContent('false');
  });

  it('SetDisconnected resets stageMounted to false', async () => {
    const user = userEvent.setup();
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    await user.click(screen.getByText('Mount Stage'));
    expect(screen.getByTestId('stage-mounted')).toHaveTextContent('true');

    await user.click(screen.getByText('Disconnect'));

    expect(screen.getByTestId('stage-mounted')).toHaveTextContent('false');
  });

  it('SetDisconnected resets stageMounted to false while preserving showVideoTiles', async () => {
    const user = userEvent.setup();
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    await user.click(screen.getByText('Mount Stage'));
    await user.click(screen.getByText('Show Video Tiles'));
    expect(screen.getByTestId('show-video-tiles')).toHaveTextContent('true');

    await user.click(screen.getByText('Disconnect'));

    expect(screen.getByTestId('stage-mounted')).toHaveTextContent('false');
    expect(screen.getByTestId('show-video-tiles')).toHaveTextContent('true');
    expect(screen.getByTestId('is-connected')).toHaveTextContent('false');
  });

  it('pipCollapsed defaults to false with no persisted placement', () => {
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    expect(screen.getByTestId('pip-collapsed')).toHaveTextContent('false');
  });

  it('SetPipCollapsed(true) sets pipCollapsed to true, SetPipCollapsed(false) sets it back', async () => {
    const user = userEvent.setup();
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    await user.click(screen.getByText('Collapse Pip'));
    expect(screen.getByTestId('pip-collapsed')).toHaveTextContent('true');

    await user.click(screen.getByText('Expand Pip'));
    expect(screen.getByTestId('pip-collapsed')).toHaveTextContent('false');
  });

  it('SetDisconnected preserves pipCollapsed alongside showVideoTiles', async () => {
    const user = userEvent.setup();
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    await user.click(screen.getByText('Show Video Tiles'));
    await user.click(screen.getByText('Collapse Pip'));
    expect(screen.getByTestId('pip-collapsed')).toHaveTextContent('true');

    await user.click(screen.getByText('Disconnect'));

    expect(screen.getByTestId('is-connected')).toHaveTextContent('false');
    expect(screen.getByTestId('show-video-tiles')).toHaveTextContent('true');
    expect(screen.getByTestId('pip-collapsed')).toHaveTextContent('true');
  });

  it('lazily initializes pipCollapsed from the persisted pip placement (collapsed: true)', () => {
    setCachedItem('semaphore_pip_placement', { ...defaultPlacement(), collapsed: true });

    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    expect(screen.getByTestId('pip-collapsed')).toHaveTextContent('true');
  });

  it('lazily initializes pipCollapsed from the persisted pip placement (collapsed: false)', () => {
    setCachedItem('semaphore_pip_placement', { ...defaultPlacement(), collapsed: false });

    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    expect(screen.getByTestId('pip-collapsed')).toHaveTextContent('false');
  });

  describe('SetPipCollapsed persistence (VoiceProvider mirrors pipCollapsed to disk directly)', () => {
    // FloatCard is never mounted in this describe block — the collapsed
    // write used to live only in FloatCard's own effect, so it was lost
    // whenever SetPipCollapsed was dispatched while FloatCard was suppressed
    // (e.g. the embedded stage is mounted, or the VoiceBottomBar settings
    // menu toggling the pill directly). It now lives in VoiceProvider, which
    // is always mounted alongside voice state.
    it('persists collapsed:true into semaphore_pip_placement with no prior record', async () => {
      const user = userEvent.setup();
      render(
        <VoiceProvider>
          <TestConsumer />
        </VoiceProvider>,
      );

      expect(getCachedItem('semaphore_pip_placement')).toBeNull();

      await user.click(screen.getByText('Collapse Pip'));

      expect(getCachedItem<PipPlacement>('semaphore_pip_placement')?.collapsed).toBe(true);
    });

    it('persists collapsed:false back after collapsed:true', async () => {
      const user = userEvent.setup();
      render(
        <VoiceProvider>
          <TestConsumer />
        </VoiceProvider>,
      );

      await user.click(screen.getByText('Collapse Pip'));
      expect(getCachedItem<PipPlacement>('semaphore_pip_placement')?.collapsed).toBe(true);

      await user.click(screen.getByText('Expand Pip'));
      expect(getCachedItem<PipPlacement>('semaphore_pip_placement')?.collapsed).toBe(false);
    });

    it('merges onto an existing persisted placement without clobbering anchor/size/docked', async () => {
      setCachedItem('semaphore_pip_placement', {
        ...defaultPlacement(),
        anchor: 'top-left',
        docked: false,
        size: { width: 500, height: 400 },
      });

      const user = userEvent.setup();
      render(
        <VoiceProvider>
          <TestConsumer />
        </VoiceProvider>,
      );

      await user.click(screen.getByText('Collapse Pip'));

      const saved = getCachedItem<PipPlacement>('semaphore_pip_placement');
      expect(saved).toMatchObject({
        anchor: 'top-left',
        docked: false,
        size: { width: 500, height: 400 },
        collapsed: true,
      });
    });

    it('discards a partial/corrupted persisted record instead of merging onto it', async () => {
      // Simulates a record left behind by an older code path that only wrote
      // `collapsed` — missing anchor/offset/size/docked makes it invalid.
      setCachedItem('semaphore_pip_placement', { collapsed: true });

      const user = userEvent.setup();
      render(
        <VoiceProvider>
          <TestConsumer />
        </VoiceProvider>,
      );

      await user.click(screen.getByText('Expand Pip'));

      const saved = getCachedItem<PipPlacement>('semaphore_pip_placement');
      expect(isValidPlacement(saved)).toBe(true);
      expect(saved?.collapsed).toBe(false);
    });

    it('does not write to storage on mount when nothing changed', () => {
      render(
        <VoiceProvider>
          <TestConsumer />
        </VoiceProvider>,
      );

      expect(getCachedItem('semaphore_pip_placement')).toBeNull();
    });

    it('persists the change even while stageMounted is true (FloatCard suppressed on desktop)', async () => {
      const user = userEvent.setup();
      render(
        <VoiceProvider>
          <TestConsumer />
        </VoiceProvider>,
      );

      await user.click(screen.getByText('Mount Stage'));
      expect(screen.getByTestId('stage-mounted')).toHaveTextContent('true');

      await user.click(screen.getByText('Collapse Pip'));

      expect(getCachedItem<PipPlacement>('semaphore_pip_placement')?.collapsed).toBe(true);
    });
  });

  it('layoutMode/pinnedTileId/spotlightTileId default to Grid/null/null', () => {
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    expect(screen.getByTestId('layout-mode')).toHaveTextContent('grid');
    expect(screen.getByTestId('pinned-tile-id')).toHaveTextContent('null');
    expect(screen.getByTestId('spotlight-tile-id')).toHaveTextContent('null');
  });

  it('SetLayoutMode sets layoutMode directly', async () => {
    const user = userEvent.setup();
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    await user.click(screen.getByText('Set Sidebar'));
    expect(screen.getByTestId('layout-mode')).toHaveTextContent('sidebar');

    await user.click(screen.getByText('Set Spotlight'));
    expect(screen.getByTestId('layout-mode')).toHaveTextContent('spotlight');
  });

  it('SetLayoutMode clears spotlightTileId when leaving Spotlight', async () => {
    const user = userEvent.setup();
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    await user.click(screen.getByText('Toggle Spotlight A'));
    expect(screen.getByTestId('layout-mode')).toHaveTextContent('spotlight');
    expect(screen.getByTestId('spotlight-tile-id')).toHaveTextContent('tile-a');

    await user.click(screen.getByText('Set Grid'));
    expect(screen.getByTestId('layout-mode')).toHaveTextContent('grid');
    expect(screen.getByTestId('spotlight-tile-id')).toHaveTextContent('null');
  });

  it('SetLayoutMode does not touch spotlightTileId when re-selecting Spotlight', async () => {
    const user = userEvent.setup();
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    await user.click(screen.getByText('Toggle Spotlight A'));
    await user.click(screen.getByText('Set Spotlight'));

    expect(screen.getByTestId('layout-mode')).toHaveTextContent('spotlight');
    expect(screen.getByTestId('spotlight-tile-id')).toHaveTextContent('tile-a');
  });

  it('TogglePinTile pins a new tile and forces Sidebar layout', async () => {
    const user = userEvent.setup();
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    expect(screen.getByTestId('layout-mode')).toHaveTextContent('grid');

    await user.click(screen.getByText('Toggle Pin A'));

    expect(screen.getByTestId('pinned-tile-id')).toHaveTextContent('tile-a');
    expect(screen.getByTestId('layout-mode')).toHaveTextContent('sidebar');
  });

  it('TogglePinTile unpins the same tile and keeps the current layout', async () => {
    const user = userEvent.setup();
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    await user.click(screen.getByText('Toggle Pin A'));
    expect(screen.getByTestId('layout-mode')).toHaveTextContent('sidebar');

    // Switch to Spotlight to verify unpin does not reset the layout back to Sidebar/Grid.
    await user.click(screen.getByText('Set Spotlight'));
    expect(screen.getByTestId('layout-mode')).toHaveTextContent('spotlight');

    await user.click(screen.getByText('Toggle Pin A'));

    expect(screen.getByTestId('pinned-tile-id')).toHaveTextContent('null');
    expect(screen.getByTestId('layout-mode')).toHaveTextContent('spotlight');
  });

  it('TogglePinTile switches the pin to a different tile and forces Sidebar', async () => {
    const user = userEvent.setup();
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    await user.click(screen.getByText('Toggle Pin A'));
    expect(screen.getByTestId('pinned-tile-id')).toHaveTextContent('tile-a');

    await user.click(screen.getByText('Toggle Pin B'));
    expect(screen.getByTestId('pinned-tile-id')).toHaveTextContent('tile-b');
    expect(screen.getByTestId('layout-mode')).toHaveTextContent('sidebar');
  });

  it('ToggleSpotlightTile spotlights a tile and sets layoutMode to Spotlight', async () => {
    const user = userEvent.setup();
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    await user.click(screen.getByText('Toggle Spotlight A'));

    expect(screen.getByTestId('spotlight-tile-id')).toHaveTextContent('tile-a');
    expect(screen.getByTestId('layout-mode')).toHaveTextContent('spotlight');
  });

  it('ToggleSpotlightTile on the same tile while spotlighted returns to Grid', async () => {
    const user = userEvent.setup();
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    await user.click(screen.getByText('Toggle Spotlight A'));
    await user.click(screen.getByText('Toggle Spotlight A'));

    expect(screen.getByTestId('spotlight-tile-id')).toHaveTextContent('null');
    expect(screen.getByTestId('layout-mode')).toHaveTextContent('grid');
  });

  it('ToggleSpotlightTile on a different tile while spotlighted switches the spotlight', async () => {
    const user = userEvent.setup();
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    await user.click(screen.getByText('Toggle Spotlight A'));
    await user.click(screen.getByText('Toggle Spotlight B'));

    expect(screen.getByTestId('spotlight-tile-id')).toHaveTextContent('tile-b');
    expect(screen.getByTestId('layout-mode')).toHaveTextContent('spotlight');
  });

  it('SetDisconnected resets layoutMode/pinnedTileId/spotlightTileId', async () => {
    const user = userEvent.setup();
    render(
      <VoiceProvider>
        <TestConsumer />
      </VoiceProvider>,
    );

    await user.click(screen.getByText('Toggle Pin A'));
    await user.click(screen.getByText('Toggle Spotlight B'));
    expect(screen.getByTestId('layout-mode')).toHaveTextContent('spotlight');

    await user.click(screen.getByText('Disconnect'));

    expect(screen.getByTestId('layout-mode')).toHaveTextContent('grid');
    expect(screen.getByTestId('pinned-tile-id')).toHaveTextContent('null');
    expect(screen.getByTestId('spotlight-tile-id')).toHaveTextContent('null');
  });
});
