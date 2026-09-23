import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import { useStagePresence } from '../../hooks/useStagePresence';
import { VoiceActionType } from '../../contexts/VoiceContext';

const mockDispatch = vi.fn();

vi.mock('../../contexts/VoiceContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../contexts/VoiceContext')>();
  return {
    ...actual,
    useVoiceDispatch: vi.fn(() => ({ dispatch: mockDispatch })),
  };
});

describe('useStagePresence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches SetStageMounted(true) on mount when active', () => {
    renderHook(() => useStagePresence(true));

    expect(mockDispatch).toHaveBeenCalledWith({
      type: VoiceActionType.SetStageMounted,
      payload: true,
    });
  });

  it('dispatches SetStageMounted(false) on unmount', () => {
    const { unmount } = renderHook(() => useStagePresence(true));
    mockDispatch.mockClear();

    unmount();

    expect(mockDispatch).toHaveBeenCalledWith({
      type: VoiceActionType.SetStageMounted,
      payload: false,
    });
  });

  it('does not dispatch when active is false', () => {
    renderHook(() => useStagePresence(false));

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('does not dispatch on unmount when it was never active', () => {
    const { unmount } = renderHook(() => useStagePresence(false));
    mockDispatch.mockClear();

    unmount();

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('ends in stageMounted=true under React.StrictMode (mount -> cleanup -> mount)', () => {
    const Harness: React.FC = () => {
      useStagePresence(true);
      return null;
    };

    render(
      <React.StrictMode>
        <Harness />
      </React.StrictMode>,
    );

    // StrictMode double-invokes the effect (mount -> cleanup -> mount); the
    // last call must be the "mounted" dispatch, i.e. state ends up true.
    const lastCall = mockDispatch.mock.calls[mockDispatch.mock.calls.length - 1];
    expect(lastCall[0]).toEqual({ type: VoiceActionType.SetStageMounted, payload: true });
  });
});
