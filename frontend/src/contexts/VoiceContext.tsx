import React, { createContext, useContext, useReducer, useRef, useEffect, useMemo } from "react";

export enum VoiceSessionType {
  Channel = 'channel',
  Dm = 'dm',
}

export interface VoiceState {
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  contextType: VoiceSessionType | null;
  currentChannelId: string | null;
  channelName: string | null;
  communityId: string | null;
  isPrivate: boolean | null;
  createdAt: string | null;
  currentDmGroupId: string | null;
  dmGroupName: string | null;
  isDeafened: boolean;
  showVideoTiles: boolean;
  screenShareAudioFailed: boolean;
  requestMaximize: boolean;
  selectedAudioInputId: string | null;
  selectedAudioOutputId: string | null;
  selectedVideoInputId: string | null;
  wasMutedBeforeDeafen: boolean;
  isServerMuted: boolean;
  watchingCameras: Set<string>;
  watchingScreenShares: Set<string>;
  hiddenLocalTiles: Set<string>;
}

export enum VoiceActionType {
  SetConnecting = 'SET_CONNECTING',
  SetConnected = 'SET_CONNECTED',
  SetDmConnected = 'SET_DM_CONNECTED',
  SetDisconnected = 'SET_DISCONNECTED',
  SetConnectionError = 'SET_CONNECTION_ERROR',
  SetDeafened = 'SET_DEAFENED',
  SetShowVideoTiles = 'SET_SHOW_VIDEO_TILES',
  SetScreenShareAudioFailed = 'SET_SCREEN_SHARE_AUDIO_FAILED',
  SetSelectedAudioInputId = 'SET_SELECTED_AUDIO_INPUT_ID',
  SetSelectedAudioOutputId = 'SET_SELECTED_AUDIO_OUTPUT_ID',
  SetRequestMaximize = 'SET_REQUEST_MAXIMIZE',
  SetSelectedVideoInputId = 'SET_SELECTED_VIDEO_INPUT_ID',
  SetWasMutedBeforeDeafen = 'SET_WAS_MUTED_BEFORE_DEAFEN',
  SetServerMuted = 'SET_SERVER_MUTED',
  WatchCamera = 'WATCH_CAMERA',
  StopWatchingCamera = 'STOP_WATCHING_CAMERA',
  WatchScreenShare = 'WATCH_SCREEN_SHARE',
  StopWatchingScreenShare = 'STOP_WATCHING_SCREEN_SHARE',
  HideLocalTile = 'HIDE_LOCAL_TILE',
  ShowLocalTile = 'SHOW_LOCAL_TILE',
}

export type VoiceAction =
  | { type: VoiceActionType.SetConnecting; payload: boolean }
  | { type: VoiceActionType.SetConnected; payload: { channelId: string; channelName: string; communityId: string; isPrivate: boolean; createdAt: string } }
  | { type: VoiceActionType.SetDmConnected; payload: { dmGroupId: string; dmGroupName: string } }
  | { type: VoiceActionType.SetDisconnected }
  | { type: VoiceActionType.SetConnectionError; payload: string }
  | { type: VoiceActionType.SetDeafened; payload: boolean }
  | { type: VoiceActionType.SetShowVideoTiles; payload: boolean }
  | { type: VoiceActionType.SetScreenShareAudioFailed; payload: boolean }
  | { type: VoiceActionType.SetSelectedAudioInputId; payload: string | null }
  | { type: VoiceActionType.SetSelectedAudioOutputId; payload: string | null }
  | { type: VoiceActionType.SetRequestMaximize; payload: boolean }
  | { type: VoiceActionType.SetSelectedVideoInputId; payload: string | null }
  | { type: VoiceActionType.SetWasMutedBeforeDeafen; payload: boolean }
  | { type: VoiceActionType.SetServerMuted; payload: boolean }
  | { type: VoiceActionType.WatchCamera; payload: string }
  | { type: VoiceActionType.StopWatchingCamera; payload: string }
  | { type: VoiceActionType.WatchScreenShare; payload: string }
  | { type: VoiceActionType.StopWatchingScreenShare; payload: string }
  | { type: VoiceActionType.HideLocalTile; payload: string }
  | { type: VoiceActionType.ShowLocalTile; payload: string };

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
  screenShareAudioFailed: false,
  requestMaximize: false,
  selectedAudioInputId: null,
  selectedAudioOutputId: null,
  selectedVideoInputId: null,
  wasMutedBeforeDeafen: false,
  isServerMuted: false,
  watchingCameras: new Set<string>(),
  watchingScreenShares: new Set<string>(),
  hiddenLocalTiles: new Set<string>(),
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
      return {
        ...initialState,
        showVideoTiles: state.showVideoTiles,
      };
    case VoiceActionType.SetConnectionError:
      return { ...state, isConnecting: false, connectionError: action.payload };
    case VoiceActionType.SetDeafened:
      return { ...state, isDeafened: action.payload };
    case VoiceActionType.SetShowVideoTiles:
      return { ...state, showVideoTiles: action.payload };
    case VoiceActionType.SetScreenShareAudioFailed:
      return { ...state, screenShareAudioFailed: action.payload };
    case VoiceActionType.SetRequestMaximize:
      return { ...state, requestMaximize: action.payload };
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
    default:
      return state;
  }
}

// Split into two contexts to avoid unnecessary re-renders
const VoiceStateContext = createContext<VoiceState | null>(null);
const VoiceDispatchContext = createContext<{
  dispatch: React.Dispatch<VoiceAction>;
  stateRef: React.RefObject<VoiceState>;
} | null>(null);

export const VoiceProvider: React.FC<{
  children: React.ReactNode;
  /**
   * Test/sandbox-only seam: seeds the reducer's initial state instead of the
   * default disconnected state (e.g. Ladle stories rendering a "connected"
   * voice bar without a real LiveKit connection). Unused in production —
   * AuthGate never passes it.
   */
  initialState?: Partial<VoiceState>;
}> = ({ children, initialState: initialStateOverride }) => {
  const [state, dispatch] = useReducer(
    voiceReducer,
    initialStateOverride ? { ...initialState, ...initialStateOverride } : initialState,
  );
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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

/** Read voice state (re-renders on changes) */
export function useVoice(): VoiceState {
  const ctx = useContext(VoiceStateContext);
  if (!ctx) throw new Error('useVoice must be used within a VoiceProvider');
  return ctx;
}

/** Get voice dispatch + stateRef (stable, no re-renders from state changes) */
export function useVoiceDispatch() {
  const ctx = useContext(VoiceDispatchContext);
  if (!ctx) throw new Error('useVoiceDispatch must be used within a VoiceProvider');
  return ctx;
}
