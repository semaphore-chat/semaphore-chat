import React, { useReducer, useRef, useEffect, useMemo } from "react";
import { VideoLayoutMode } from "../types/videoLayout";
import { getCachedItem, setCachedItem } from "../utils/storage";
import { defaultPlacement, isValidPlacement } from "../utils/pipPosition";
import {
  VoiceActionType,
  VoiceDispatchContext,
  VoiceSessionType,
  VoiceStateContext,
  type VoiceAction,
  type VoiceState,
} from "./VoiceContext";

const initialState: VoiceState = {
  isConnected: false,
  isConnecting: false,
  connectionError: null,
  contextType: null,
  currentChannelId: null,
  channelName: null,
  communityId: null,
  isPrivate: null,
  createdAt: null,
  currentDmGroupId: null,
  dmGroupName: null,
  isDeafened: false,
  showVideoTiles: false,
  pipCollapsed: false,
  screenShareAudioFailed: false,
  selectedAudioInputId: null,
  selectedAudioOutputId: null,
  selectedVideoInputId: null,
  wasMutedBeforeDeafen: false,
  isServerMuted: false,
  watchingCameras: new Set<string>(),
  watchingScreenShares: new Set<string>(),
  hiddenLocalTiles: new Set<string>(),
  stageMounted: false,
  layoutMode: VideoLayoutMode.Grid,
  pinnedTileId: null,
  spotlightTileId: null,
};

function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case VoiceActionType.SetConnecting:
      return {
        ...state,
        isConnecting: action.payload,
        ...(action.payload ? { connectionError: null } : {}),
      };
    case VoiceActionType.SetConnected:
      return {
        ...state,
        isConnected: true,
        isConnecting: false,
        connectionError: null,
        contextType: VoiceSessionType.Channel,
        currentChannelId: action.payload.channelId,
        channelName: action.payload.channelName,
        communityId: action.payload.communityId,
        isPrivate: action.payload.isPrivate,
        createdAt: action.payload.createdAt,
        currentDmGroupId: null,
        dmGroupName: null,
      };
    case VoiceActionType.SetDmConnected:
      return {
        ...state,
        isConnected: true,
        isConnecting: false,
        connectionError: null,
        contextType: VoiceSessionType.Dm,
        currentDmGroupId: action.payload.dmGroupId,
        dmGroupName: action.payload.dmGroupName,
        currentChannelId: null,
        channelName: null,
        communityId: null,
        isPrivate: null,
        createdAt: null,
      };
    case VoiceActionType.SetDisconnected:
      // showVideoTiles and pipCollapsed are persisted-natured UI prefs (the
      // pill/panel should stay however the user left it, not reset on hangup).
      return {
        ...initialState,
        showVideoTiles: state.showVideoTiles,
        pipCollapsed: state.pipCollapsed,
      };
    case VoiceActionType.SetConnectionError:
      return { ...state, isConnecting: false, connectionError: action.payload };
    case VoiceActionType.SetDeafened:
      return { ...state, isDeafened: action.payload };
    case VoiceActionType.SetShowVideoTiles:
      return { ...state, showVideoTiles: action.payload };
    case VoiceActionType.SetPipCollapsed:
      return { ...state, pipCollapsed: action.payload };
    case VoiceActionType.SetScreenShareAudioFailed:
      return { ...state, screenShareAudioFailed: action.payload };
    case VoiceActionType.SetSelectedAudioInputId:
      return { ...state, selectedAudioInputId: action.payload };
    case VoiceActionType.SetSelectedAudioOutputId:
      return { ...state, selectedAudioOutputId: action.payload };
    case VoiceActionType.SetSelectedVideoInputId:
      return { ...state, selectedVideoInputId: action.payload };
    case VoiceActionType.SetWasMutedBeforeDeafen:
      return { ...state, wasMutedBeforeDeafen: action.payload };
    case VoiceActionType.SetServerMuted:
      return { ...state, isServerMuted: action.payload };
    case VoiceActionType.WatchCamera: {
      if (state.watchingCameras.has(action.payload)) return state;
      const next = new Set(state.watchingCameras);
      next.add(action.payload);
      return { ...state, watchingCameras: next };
    }
    case VoiceActionType.StopWatchingCamera: {
      if (!state.watchingCameras.has(action.payload)) return state;
      const next = new Set(state.watchingCameras);
      next.delete(action.payload);
      return { ...state, watchingCameras: next };
    }
    case VoiceActionType.WatchScreenShare: {
      if (state.watchingScreenShares.has(action.payload)) return state;
      const next = new Set(state.watchingScreenShares);
      next.add(action.payload);
      return { ...state, watchingScreenShares: next };
    }
    case VoiceActionType.StopWatchingScreenShare: {
      if (!state.watchingScreenShares.has(action.payload)) return state;
      const next = new Set(state.watchingScreenShares);
      next.delete(action.payload);
      return { ...state, watchingScreenShares: next };
    }
    case VoiceActionType.HideLocalTile: {
      if (state.hiddenLocalTiles.has(action.payload)) return state;
      const next = new Set(state.hiddenLocalTiles);
      next.add(action.payload);
      return { ...state, hiddenLocalTiles: next };
    }
    case VoiceActionType.ShowLocalTile: {
      if (!state.hiddenLocalTiles.has(action.payload)) return state;
      const next = new Set(state.hiddenLocalTiles);
      next.delete(action.payload);
      return { ...state, hiddenLocalTiles: next };
    }
    case VoiceActionType.SetStageMounted:
      return { ...state, stageMounted: action.payload };
    case VoiceActionType.SetLayoutMode:
      return {
        ...state,
        layoutMode: action.payload,
        ...(action.payload !== VideoLayoutMode.Spotlight ? { spotlightTileId: null } : {}),
      };
    case VoiceActionType.TogglePinTile: {
      if (state.pinnedTileId === action.payload) {
        return { ...state, pinnedTileId: null };
      }
      return { ...state, pinnedTileId: action.payload, layoutMode: VideoLayoutMode.Sidebar };
    }
    case VoiceActionType.ToggleSpotlightTile: {
      if (state.layoutMode === VideoLayoutMode.Spotlight && state.spotlightTileId === action.payload) {
        return { ...state, spotlightTileId: null, layoutMode: VideoLayoutMode.Grid };
      }
      return { ...state, spotlightTileId: action.payload, layoutMode: VideoLayoutMode.Spotlight };
    }
    default:
      return state;
  }
}

// Same on-disk record FloatCard reads/writes (utils/pipPosition.ts's
// PipPlacement); read narrowly here so the pill's collapsed state survives a
// reload without pulling in the full placement geometry/validation.
const PIP_PLACEMENT_KEY = 'semaphore_pip_placement';

function initVoiceState(base: VoiceState): VoiceState {
  const saved = getCachedItem<unknown>(PIP_PLACEMENT_KEY);
  const collapsed = !!saved && typeof saved === 'object' && typeof (saved as { collapsed?: unknown }).collapsed === 'boolean'
    ? (saved as { collapsed: boolean }).collapsed
    : base.pipCollapsed;
  return { ...base, pipCollapsed: collapsed };
}

export const VoiceProvider: React.FC<{
  children: React.ReactNode;
  /**
   * Test/sandbox-only seam: seeds the reducer's initial state instead of the
   * default disconnected state (e.g. Ladle stories rendering a "connected"
   * voice bar without a real LiveKit connection). Applied on top of the
   * persisted state, so it wins. Unused in production — AuthGate never
   * passes it.
   */
  initialState?: Partial<VoiceState>;
}> = ({ children, initialState: initialStateOverride }) => {
  const [state, dispatch] = useReducer(voiceReducer, initialState, (base: VoiceState) => {
    const loaded = initVoiceState(base);
    return initialStateOverride ? { ...loaded, ...initialStateOverride } : loaded;
  });
  const stateRef = useRef(state);
  // Tracks the last-persisted value so the mirror effect below only writes
  // on an actual change, never on mount (initVoiceState already loaded it).
  const persistedCollapsedRef = useRef(state.pipCollapsed);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // pipCollapsed can change while FloatCard isn't mounted at all — the
  // VoiceBottomBar settings menu dispatches SetPipCollapsed directly, and
  // useTrackSubscription's auto-reveal does too — so FloatCard's own mount
  // lifecycle can't be the thing that persists it. Do it here instead, at
  // the provider level, which is always mounted whenever voice state exists.
  // Merges onto whatever's already on disk (falling back to defaultPlacement
  // if it's missing/invalid) so anchor/size/docked survive untouched.
  useEffect(() => {
    if (persistedCollapsedRef.current === state.pipCollapsed) return;
    persistedCollapsedRef.current = state.pipCollapsed;
    const saved = getCachedItem<unknown>(PIP_PLACEMENT_KEY);
    const base = isValidPlacement(saved) ? saved : defaultPlacement();
    setCachedItem(PIP_PLACEMENT_KEY, { ...base, collapsed: state.pipCollapsed });
  }, [state.pipCollapsed]);

  // Memoize dispatch context value so consumers (like RoomProvider) that only
  // need dispatch/stateRef don't re-render on every VoiceState change.
  const dispatchValue = useMemo(() => ({ dispatch, stateRef }), [dispatch, stateRef]);

  return (
    <VoiceDispatchContext.Provider value={dispatchValue}>
      <VoiceStateContext.Provider value={state}>
        {children}
      </VoiceStateContext.Provider>
    </VoiceDispatchContext.Provider>
  );
};
