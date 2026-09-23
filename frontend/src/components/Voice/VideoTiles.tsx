import React, { useEffect, useMemo, useCallback, useState } from 'react';
import {
  Box,
  IconButton,
  Tooltip,
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import {
  CropFree,
  GridView,
  ViewSidebar,
} from '@mui/icons-material';
import { useVoiceConnection } from '../../hooks/useVoiceConnection';
import { useLocalMediaState } from '../../hooks/useLocalMediaState';
import { useResponsive } from '../../hooks/useResponsive';
import { useReplayBufferState } from '../../contexts/ReplayBufferContext';
import { useVoice, useVoiceDispatch, VoiceActionType } from '../../contexts/VoiceContext';
import { useTrackSubscriptionActions } from '../../hooks/useTrackSubscription';
import VideoTile from './VideoTile';
import { VideoLayoutMode } from '../../types/videoLayout';

// Re-exported so existing importers of VideoLayoutMode from this module keep working.
export { VideoLayoutMode };

// Constants
const GRID_CONSTANTS = {
  SIDEBAR_WIDTH: 200,
  SIDEBAR_TILE_HEIGHT: 150,
  HEADER_HEIGHT: 48,
  MAX_SIDEBAR_TILES: 6,
} as const;
import { Track, RoomEvent } from 'livekit-client';
import type {
  TrackPublication,
  RemoteParticipant,
  LocalParticipant,
} from 'livekit-client';

interface VideoTileData {
  participant: RemoteParticipant | LocalParticipant;
  videoTrack?: TrackPublication;
  screenTrack?: TrackPublication;
  audioTrack?: TrackPublication;
  isLocal: boolean;
  tileType: 'camera' | 'screen' | 'placeholder-camera' | 'placeholder-screen' | 'avatar';
  tileId: string; // unique identifier for this tile
}

export const VideoTiles: React.FC = () => {
  const theme = useTheme();
  const { state } = useVoiceConnection();
  const { isCameraEnabled, isScreenShareEnabled } = useLocalMediaState();
  const { isMobile, isPortrait } = useResponsive();
  const { isReplayBufferActive } = useReplayBufferState();
  const { watchingCameras, watchingScreenShares, hiddenLocalTiles, layoutMode, pinnedTileId, spotlightTileId } = useVoice();
  const { dispatch } = useVoiceDispatch();
  const trackActions = useTrackSubscriptionActions();
  const [trackUpdate, setTrackUpdate] = useState(0); // Force re-render on track changes

  // Define callbacks before any early returns (React hooks must be called unconditionally)
  // Memoize grid layout calculation
  const getGridCols = useCallback((tileCount: number) => {
    // Mobile: use 1-2 columns max for better visibility
    if (isMobile) {
      if (tileCount <= 1) return 1;
      if (tileCount <= 4) return isPortrait ? 1 : 2;
      return 2;
    }

    // Desktop: original logic
    if (tileCount <= 1) return 1;
    if (tileCount <= 4) return 2;
    if (tileCount <= 9) return 3;
    return 4;
  }, [isMobile, isPortrait]);

  const handleTilePin = useCallback((tileId: string) => {
    dispatch({ type: VoiceActionType.TogglePinTile, payload: tileId });
  }, [dispatch]);

  const handleTileSpotlight = useCallback((tileId: string) => {
    dispatch({ type: VoiceActionType.ToggleSpotlightTile, payload: tileId });
  }, [dispatch]);

  // Memoize video tiles to avoid recalculating on every render
  const videoTiles = useMemo((): VideoTileData[] => {
    if (!state.room) return [];

    const tiles: VideoTileData[] = [];
    const localParticipant = state.room.localParticipant;
    const participants = Array.from(state.room.remoteParticipants.values());

    // Add local participant tiles (hidden ones become placeholders); if none
    // of this produces a tile, an avatar tile is added below.
    // Pick the microphone publication explicitly — a screen share with audio also
    // publishes a ScreenShareAudio track, which must not drive the mic indicator.
    const localAudioTrack = Array.from(localParticipant.audioTrackPublications.values()).find(
      (track: TrackPublication) => track.source === Track.Source.Microphone
    );
    const localTileCountBefore = tiles.length;

    if (isCameraEnabled || isScreenShareEnabled) {
      const videoTracks = Array.from(localParticipant.videoTrackPublications.values());

      const videoTrack = videoTracks.find((track: TrackPublication) =>
        track.source !== 'screen_share' && track.source !== 'screen_share_audio'
      );
      const screenTrack = videoTracks.find((track: TrackPublication) =>
        track.source === 'screen_share' || track.source === 'screen_share_audio'
      );

      const cameraHidden = hiddenLocalTiles.has('camera');
      const screenHidden = hiddenLocalTiles.has('screen');

      if (videoTrack && !videoTrack.isMuted) {
        if (cameraHidden) {
          tiles.push({
            participant: localParticipant,
            isLocal: true,
            tileType: 'placeholder-camera',
            tileId: `${localParticipant.identity}-placeholder-camera`
          });
        } else {
          tiles.push({
            participant: localParticipant,
            videoTrack,
            audioTrack: localAudioTrack,
            isLocal: true,
            tileType: 'camera',
            tileId: `${localParticipant.identity}-camera`
          });
        }
      }
      if (screenTrack) {
        if (screenHidden) {
          tiles.push({
            participant: localParticipant,
            isLocal: true,
            tileType: 'placeholder-screen',
            tileId: `${localParticipant.identity}-placeholder-screen`
          });
        } else {
          tiles.push({
            participant: localParticipant,
            screenTrack,
            audioTrack: localAudioTrack,
            isLocal: true,
            tileType: 'screen',
            tileId: `${localParticipant.identity}-screen`
          });
        }
      }
    }

    // No camera/screen tile produced for the local participant — fall back
    // to an avatar tile so they always appear in the grid.
    if (tiles.length === localTileCountBefore) {
      tiles.push({
        participant: localParticipant,
        audioTrack: localAudioTrack,
        isLocal: true,
        tileType: 'avatar',
        tileId: `${localParticipant.identity}-avatar`
      });
    }

    // Add remote participant tiles — only subscribed (watched) tracks get real tiles;
    // unwatched tracks get placeholder tiles so users can opt in from the grid.
    participants.forEach(participant => {
      const videoTracks = Array.from(participant.videoTrackPublications.values());
      // Pick the microphone publication explicitly — a screen share with audio also
      // publishes a ScreenShareAudio track, which must not drive the mic indicator.
      const audioTrack = Array.from(participant.audioTrackPublications.values()).find(
        (track: TrackPublication) => track.source === Track.Source.Microphone
      );

      const videoTrack = videoTracks.find((track: TrackPublication) =>
        track.source !== 'screen_share' && track.source !== 'screen_share_audio'
      );
      const screenTrack = videoTracks.find((track: TrackPublication) =>
        track.source === 'screen_share' || track.source === 'screen_share_audio'
      );

      const isWatchingCamera = watchingCameras.has(participant.identity);
      const isWatchingScreen = watchingScreenShares.has(participant.identity);
      const tileCountBefore = tiles.length;

      // Camera tile
      if (videoTrack && !videoTrack.isMuted) {
        if (isWatchingCamera) {
          tiles.push({
            participant,
            videoTrack,
            audioTrack,
            isLocal: false,
            tileType: 'camera',
            tileId: `${participant.identity}-camera`
          });
        } else {
          tiles.push({
            participant,
            isLocal: false,
            tileType: 'placeholder-camera',
            tileId: `${participant.identity}-placeholder-camera`
          });
        }
      }

      // Screen share tile
      if (screenTrack) {
        if (isWatchingScreen) {
          tiles.push({
            participant,
            screenTrack,
            audioTrack,
            isLocal: false,
            tileType: 'screen',
            tileId: `${participant.identity}-screen`
          });
        } else {
          tiles.push({
            participant,
            isLocal: false,
            tileType: 'placeholder-screen',
            tileId: `${participant.identity}-placeholder-screen`
          });
        }
      }

      // No camera/screen tile produced for this participant — fall back to
      // an avatar tile so every connected participant appears in the grid.
      if (tiles.length === tileCountBefore) {
        tiles.push({
          participant,
          audioTrack,
          isLocal: false,
          tileType: 'avatar',
          tileId: `${participant.identity}-avatar`
        });
      }
    });

    return tiles;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- trackUpdate triggers recomputation when remote tracks change
  }, [state.room, isCameraEnabled, isScreenShareEnabled, trackUpdate, watchingCameras, watchingScreenShares, hiddenLocalTiles]);

  // Listen to LiveKit room events for track publications/unpublications
  useEffect(() => {
    if (!state.room) return;

    const handleTrackChange = () => {
      setTrackUpdate((prev) => prev + 1);
    };

    // Local participant events
    state.room.localParticipant.on('trackPublished', handleTrackChange);
    state.room.localParticipant.on('trackUnpublished', handleTrackChange);

    // Remote participant events (Room-level events cover all remote participants)
    state.room.on(RoomEvent.TrackPublished, handleTrackChange);
    state.room.on(RoomEvent.TrackUnpublished, handleTrackChange);
    state.room.on(RoomEvent.TrackSubscribed, handleTrackChange);
    state.room.on(RoomEvent.TrackUnsubscribed, handleTrackChange);
    state.room.on(RoomEvent.TrackMuted, handleTrackChange);
    state.room.on(RoomEvent.TrackUnmuted, handleTrackChange);
    state.room.on(RoomEvent.ParticipantDisconnected, handleTrackChange);
    state.room.on(RoomEvent.ParticipantConnected, handleTrackChange);

    return () => {
      state.room?.localParticipant.off('trackPublished', handleTrackChange);
      state.room?.localParticipant.off('trackUnpublished', handleTrackChange);
      state.room?.off(RoomEvent.TrackPublished, handleTrackChange);
      state.room?.off(RoomEvent.TrackUnpublished, handleTrackChange);
      state.room?.off(RoomEvent.TrackSubscribed, handleTrackChange);
      state.room?.off(RoomEvent.TrackUnsubscribed, handleTrackChange);
      state.room?.off(RoomEvent.TrackMuted, handleTrackChange);
      state.room?.off(RoomEvent.TrackUnmuted, handleTrackChange);
      state.room?.off(RoomEvent.ParticipantDisconnected, handleTrackChange);
      state.room?.off(RoomEvent.ParticipantConnected, handleTrackChange);
    };
  }, [state.room]);

  // Callback for placeholder tile watch/show actions
  const handleWatchTile = useCallback((tile: VideoTileData) => {
    if (tile.isLocal) {
      // Local placeholder — show the hidden tile
      const type = tile.tileType === 'placeholder-camera' ? 'camera' : 'screen';
      dispatch({ type: VoiceActionType.ShowLocalTile, payload: type });
    } else if (tile.tileType === 'placeholder-camera') {
      trackActions?.watchCamera(tile.participant.identity);
    } else if (tile.tileType === 'placeholder-screen') {
      trackActions?.watchScreenShare(tile.participant.identity);
    }
  }, [trackActions, dispatch]);

  // Callback for stopping watching a remote tile
  const handleStopWatchingTile = useCallback((tile: VideoTileData) => {
    if (tile.tileType === 'camera') {
      trackActions?.stopWatchingCamera(tile.participant.identity);
    } else if (tile.tileType === 'screen') {
      trackActions?.stopWatchingScreenShare(tile.participant.identity);
    }
  }, [trackActions]);

  // Callback for hiding a local tile
  const handleHideLocalTile = useCallback((tile: VideoTileData) => {
    const type = tile.tileType === 'camera' ? 'camera' : 'screen';
    dispatch({ type: VoiceActionType.HideLocalTile, payload: type });
  }, [dispatch]);

  // Watch + pin a placeholder tile (subscribe then make it the main sidebar view).
  // TogglePinTile flips pin state, so only dispatch if this tile isn't already
  // pinned — avoids unpinning a stale pinnedTileId left over from a prior
  // watch/unwatch cycle on the same tile.
  const handleWatchAndPin = useCallback((tile: VideoTileData) => {
    handleWatchTile(tile);
    const realTileId = tile.tileId.replace('placeholder-', '');
    if (pinnedTileId !== realTileId) {
      dispatch({ type: VoiceActionType.TogglePinTile, payload: realTileId });
    }
  }, [handleWatchTile, pinnedTileId, dispatch]);

  // Filter out placeholder tiles for focused layouts
  const watchedTiles = useMemo(
    () => videoTiles.filter(t => !t.tileType.startsWith('placeholder')),
    [videoTiles],
  );

  // Early return if not connected
  if (!state.isConnected || !state.room) {
    return null;
  }

  // Layout rendering functions
  const renderGridLayout = () => {
    const cols = getGridCols(videoTiles.length);
    const rows = Math.ceil(videoTiles.length / cols);
    const tileWidth = `${100 / cols}%`;
    const tileHeight = `${100 / rows}%`;

    return (
      <Box sx={{
        display: 'flex',
        flexWrap: 'wrap',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
      }}>
        {videoTiles.map((tile) => (
          <Box
            key={tile.tileId}
            sx={{
              width: tileWidth,
              height: tileHeight,
              p: 0.5,
              boxSizing: 'border-box',
            }}
          >
            <VideoTile
              participant={tile.participant}
              videoTrack={tile.videoTrack}
              audioTrack={tile.audioTrack}
              screenTrack={tile.screenTrack}
              isLocal={tile.isLocal}
              isReplayBufferActive={isReplayBufferActive}
              onToggleFullscreen={tile.tileType.startsWith('placeholder') ? undefined : () => handleTileSpotlight(tile.tileId)}
              isSpotlighted={spotlightTileId === tile.tileId}
              isPlaceholder={tile.tileType.startsWith('placeholder')}
              placeholderType={tile.tileType === 'placeholder-camera' ? 'camera' : tile.tileType === 'placeholder-screen' ? 'screen' : undefined}
              onWatch={tile.tileType === 'avatar' ? undefined : () => handleWatchTile(tile)}
              onStopWatching={
                tile.tileType.startsWith('placeholder') || tile.tileType === 'avatar' ? undefined :
                tile.isLocal ? () => handleHideLocalTile(tile) :
                () => handleStopWatchingTile(tile)
              }
            />
          </Box>
        ))}
      </Box>
    );
  };

  const renderSidebarLayout = () => {
    const pinnedTile = watchedTiles.find(tile => tile.tileId === pinnedTileId) || watchedTiles[0];
    if (!pinnedTile) return renderGridLayout(); // Fall back to grid if nothing watched

    // Sidebar: other watched tiles + placeholder tiles for unwatched participants
    const placeholderTiles = videoTiles.filter(t => t.tileType.startsWith('placeholder'));
    const otherWatched = watchedTiles.filter(tile => tile.tileId !== pinnedTile.tileId);
    const sidebarTiles = [...otherWatched, ...placeholderTiles].slice(0, GRID_CONSTANTS.MAX_SIDEBAR_TILES);

    return (
      <Box sx={{ display: 'flex', height: '100%', gap: 1, overflow: 'hidden' }}>
        {/* Main pinned video */}
        <Box sx={{ flex: 1, minWidth: 0, height: '100%' }}>
          <VideoTile
            participant={pinnedTile.participant}
            videoTrack={pinnedTile.videoTrack}
            audioTrack={pinnedTile.audioTrack}
            screenTrack={pinnedTile.screenTrack}
            isLocal={pinnedTile.isLocal}
            isReplayBufferActive={isReplayBufferActive}
            onToggleFullscreen={() => handleTileSpotlight(pinnedTile.tileId)}
            isSpotlighted={spotlightTileId === pinnedTile.tileId}
            onStopWatching={
              pinnedTile.tileType === 'avatar' ? undefined :
              pinnedTile.isLocal ? () => handleHideLocalTile(pinnedTile) :
              () => handleStopWatchingTile(pinnedTile)
            }
          />
        </Box>

        {/* Sidebar with other videos + placeholders */}
        {sidebarTiles.length > 0 && (
          <Box sx={{
            width: GRID_CONSTANTS.SIDEBAR_WIDTH,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            overflowY: 'auto',
            height: '100%',
            flexShrink: 0
          }}>
            {sidebarTiles.map((tile) => (
              <Box key={tile.tileId} sx={{
                height: GRID_CONSTANTS.SIDEBAR_TILE_HEIGHT,
                flexShrink: 0
              }}>
                <VideoTile
                  participant={tile.participant}
                  videoTrack={tile.videoTrack}
                  audioTrack={tile.audioTrack}
                  screenTrack={tile.screenTrack}
                  isLocal={tile.isLocal}
                  isReplayBufferActive={isReplayBufferActive}
                  onToggleFullscreen={tile.tileType.startsWith('placeholder') ? undefined : () => handleTilePin(tile.tileId)}
                  isSpotlighted={spotlightTileId === tile.tileId}
                  isPlaceholder={tile.tileType.startsWith('placeholder')}
                  placeholderType={tile.tileType === 'placeholder-camera' ? 'camera' : tile.tileType === 'placeholder-screen' ? 'screen' : undefined}
                  onWatch={tile.tileType === 'avatar' ? undefined : () => handleWatchAndPin(tile)}
                  onStopWatching={
                    tile.tileType.startsWith('placeholder') || tile.tileType === 'avatar' ? undefined :
                    tile.isLocal ? () => handleHideLocalTile(tile) :
                    () => handleStopWatchingTile(tile)
                  }
                />
              </Box>
            ))}
          </Box>
        )}
      </Box>
    );
  };

  const renderSpotlightLayout = () => {
    const spotlightedTile = watchedTiles.find(tile => tile.tileId === spotlightTileId) || watchedTiles[0];
    if (!spotlightedTile) return renderGridLayout(); // Fall back to grid if nothing watched

    return (
      <Box sx={{ height: '100%', width: '100%' }}>
        <VideoTile
          participant={spotlightedTile.participant}
          videoTrack={spotlightedTile.videoTrack}
          audioTrack={spotlightedTile.audioTrack}
          screenTrack={spotlightedTile.screenTrack}
          isLocal={spotlightedTile.isLocal}
          isReplayBufferActive={isReplayBufferActive}
          onToggleFullscreen={() => handleTileSpotlight(spotlightedTile.tileId)}
          isSpotlighted={true}
          onStopWatching={
            spotlightedTile.tileType === 'avatar' ? undefined :
            spotlightedTile.isLocal ? () => handleHideLocalTile(spotlightedTile) :
            () => handleStopWatchingTile(spotlightedTile)
          }
        />
      </Box>
    );
  };

  return (
    <Box sx={{
      width: '100%',
      height: '100%',
      backgroundColor: 'grey.900',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Layout Controls Header - hide on mobile */}
      {!isMobile && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            p: 1,
            borderBottom: `1px solid ${theme.palette.divider}`,
            minHeight: GRID_CONSTANTS.HEADER_HEIGHT,
            flexShrink: 0
          }}
        >
          {/* Layout mode buttons */}
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="Grid Layout">
              <IconButton
                size="small"
                onClick={() => dispatch({ type: VoiceActionType.SetLayoutMode, payload: VideoLayoutMode.Grid })}
                sx={{
                  backgroundColor: layoutMode === VideoLayoutMode.Grid ? alpha(theme.palette.primary.main, 0.8) : theme.palette.action.hover,
                  color: theme.palette.text.primary,
                  '&:hover': {
                    backgroundColor: layoutMode === VideoLayoutMode.Grid ? theme.palette.primary.main : theme.palette.action.selected,
                  },
                }}
              >
                <GridView fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="Sidebar Layout">
              <IconButton
                size="small"
                onClick={() => dispatch({ type: VoiceActionType.SetLayoutMode, payload: VideoLayoutMode.Sidebar })}
                sx={{
                  backgroundColor: layoutMode === VideoLayoutMode.Sidebar ? alpha(theme.palette.primary.main, 0.8) : theme.palette.action.hover,
                  color: theme.palette.text.primary,
                  '&:hover': {
                    backgroundColor: layoutMode === VideoLayoutMode.Sidebar ? theme.palette.primary.main : theme.palette.action.selected,
                  },
                }}
              >
                <ViewSidebar fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="Spotlight Layout">
              <IconButton
                size="small"
                onClick={() => dispatch({ type: VoiceActionType.SetLayoutMode, payload: VideoLayoutMode.Spotlight })}
                sx={{
                  backgroundColor: layoutMode === VideoLayoutMode.Spotlight ? alpha(theme.palette.primary.main, 0.8) : theme.palette.action.hover,
                  color: theme.palette.text.primary,
                  '&:hover': {
                    backgroundColor: layoutMode === VideoLayoutMode.Spotlight ? theme.palette.primary.main : theme.palette.action.selected,
                  },
                }}
              >
                <CropFree fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      )}

      {/* Main Video Area */}
      <Box sx={{ flex: 1, overflow: 'hidden', p: isMobile ? 0.5 : 1, minHeight: 0 }}>
        {layoutMode === VideoLayoutMode.Grid && renderGridLayout()}
        {layoutMode === VideoLayoutMode.Sidebar && renderSidebarLayout()}
        {layoutMode === VideoLayoutMode.Spotlight && renderSpotlightLayout()}
      </Box>
    </Box>
  );
};