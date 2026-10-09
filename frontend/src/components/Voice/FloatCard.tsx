import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  IconButton,
  Typography,
  Tooltip,
  Badge,
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import {
  Minimize,
  OpenInFull,
  DragIndicator,
  People,
  Mic,
  MicOff,
  Videocam,
  VideocamOff,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useVoiceConnection } from '../../hooks/useVoiceConnection';
import { useLocalMediaState } from '../../hooks/useLocalMediaState';
import { useFloatTileSelection } from '../../hooks/useFloatTileSelection';
import { usePushToTalk } from '../../hooks/usePushToTalk';
import { useVoicePublishPermissions } from '../../hooks/useVoicePublishPermissions';
import { useReplayBufferState } from '../../contexts/ReplayBufferContext';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { getFloatNavigationTarget } from '../../utils/voiceNavigation';
import { getCachedItem, setCachedItem } from '../../utils/storage';
import { VOICE_BAR_HEIGHT } from '../../constants/layout';
import { BOTTOM_CHROME_ORDER, useBottomChromeOffset } from '../../contexts/BottomChromeContext';
import { useResponsive } from '../../hooks/useResponsive';
import { TOUCH_TARGETS } from '../../utils/breakpoints';
import {
  PipPlacement,
  Point,
  Size,
  Viewport,
  toAbsolute,
  fromAbsolute,
  clampSizeToViewport,
  hitTestDockZone,
  defaultPlacement,
  isValidPlacement,
  defaultRegionPlacement,
  regionFitsCard,
  regionViewport,
  viewportBucket,
  type Rect,
} from '../../utils/pipPosition';
import { useFloatDockRegion } from '../../hooks/useFloatDockRegion';
import UserAvatar from '../Common/UserAvatar';
import VideoTile from './VideoTile';
import DockZonesOverlay from './DockZonesOverlay';

// Constants
const PIP_PLACEMENT_KEY = 'semaphore_pip_placement';
const HEADER_HEIGHT = 36;
// Approximate collapsed-pill footprint, used only to anchor it to the same
// corner as the card — the pill's real size can vary slightly with content,
// but EDGE_PADDING clamping keeps it fully on-screen regardless.
const PILL_SIZE: Size = { width: 200, height: 52 };

// Pointer movement (px) from pointerdown before a gesture on the header
// becomes a drag. Below this, a pointerdown+pointerup is treated as a plain
// click — no dock zones shown, no placement change.
const DRAG_THRESHOLD_PX = 5;

/** Visible size of the float card's control buttons on touch (hit area is 44px). */
const FLOAT_TOUCH_BUTTON = 36;

/**
 * Placement inside the message column, remembered per window-width bucket
 * (a spot that suits a 2560 window rarely suits a 1280 one). The window-
 * based placement keeps the original single key, unchanged.
 */
const chatPlacementKey = (windowWidth: number) => `${PIP_PLACEMENT_KEY}:chat:${viewportBucket(windowWidth)}`;

function loadPlacement(region: Rect | null): PipPlacement {
  const key = region ? chatPlacementKey(window.innerWidth) : PIP_PLACEMENT_KEY;
  const saved = getCachedItem<unknown>(key);
  if (isValidPlacement(saved)) return saved;
  return region ? defaultRegionPlacement(region) : defaultPlacement();
}

/**
 * `chromeBottom` is everything registered in BottomChromeContext below the
 * composer level — the voice bar, plus the in-flow bottom nav on tablet — so
 * the card never covers the bar's controls. VOICE_BAR_HEIGHT stays as a floor
 * while connected, for the moment before the bar has measured itself.
 */
function computeViewport(isConnected: boolean, chromeBottom: number): Viewport {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    bottomInset: Math.max(chromeBottom, isConnected ? VOICE_BAR_HEIGHT : 0),
  };
}

/**
 * Active-speaker float card ("Stage, Float, Dock" — the Float piece). Shown
 * by PersistentVideoOverlay's desktop branch when connected to voice but the
 * embedded stage isn't mounted. Content is a single tile chosen by
 * useFloatTileSelection (watched screen share > active speaker's camera >
 * avatar), not the full VideoTiles grid.
 *
 * Position is anchor-relative (see utils/pipPosition.ts) so it survives
 * viewport resizes and supports opt-in corner docking. `placement` is the
 * persisted source of truth; `dragPos`/`liveSize` are transient absolute
 * values used only while a drag or resize gesture is in flight.
 */
export const FloatCard: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { state, actions } = useVoiceConnection();
  const { isCameraEnabled, isMicrophoneEnabled } = useLocalMediaState();
  const { isReplayBufferActive } = useReplayBufferState();
  // Mirrors VoiceBottomBar's mic-button guard: while push-to-talk is active
  // (or the server has muted this user) a tap shouldn't toggle the mic —
  // PTT owns the mic state via hold-to-talk, and a stray unmute here would
  // persist outside the PTT gesture.
  const publish = useVoicePublishPermissions();
  const { isActive: isPTTActive } = usePushToTalk({ canSpeak: publish.canSpeak });
  const micGuarded = isPTTActive || state.isServerMuted;
  // Channel voice permissions (SPEAK / VIDEO, a timeout removes both): a
  // control is disabled only when it would turn something ON
  const micBlocked = !publish.canSpeak && !isMicrophoneEnabled;
  const cameraBlocked = !publish.canVideo && !isCameraEnabled;
  const selection = useFloatTileSelection();
  // Phone/tablet layouts (never in Electron, which is always desktop): the
  // composer spans the content column right above the voice bar, so the card
  // must clear it too — otherwise its default bottom-right spot sits on the
  // text field. On desktop the card's corner is over the member list, so
  // only the chrome below the composer (the voice bar) counts.
  const { isMobile, isTablet } = useResponsive();
  const touchLayout = isMobile || isTablet;
  const chromeBottom = useBottomChromeOffset(
    touchLayout ? BOTTOM_CHROME_ORDER.TOAST : BOTTOM_CHROME_ORDER.COMPOSER,
  ).px;
  const [isCardHovered, setIsCardHovered] = useState(false);

  // Desktop text views: dock inside the message column, above the composer
  // (null elsewhere — voice stage, settings, touch layouts — where the card
  // keeps its original window-based placement).
  const region = useFloatDockRegion(!touchLayout);
  const regionMode = region !== null;
  // A column too small for even the smallest card shows the pill instead.
  const forcePill = !!region && !regionFitsCard(region);
  const storageKey = region ? chatPlacementKey(window.innerWidth) : PIP_PLACEMENT_KEY;

  const [placement, setPlacement] = useState<PipPlacement>(() => loadPlacement(region));
  const [viewport, setViewport] = useState<Viewport>(() =>
    region ? regionViewport(region) : computeViewport(state.isConnected, chromeBottom),
  );

  // Switching between window and column placement (or between width
  // buckets) loads that mode's own saved placement.
  const loadedKeyRef = useRef(storageKey);
  useEffect(() => {
    if (loadedKeyRef.current === storageKey) return;
    loadedKeyRef.current = storageKey;
    const next = loadPlacement(region);
    setPlacement({ ...next, collapsed: state.pipCollapsed });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the storage key changes
  }, [storageKey]);

  // Transient gesture state — absolute pixel position/size while a
  // drag/resize is in progress. null when idle, so rendered position/size
  // falls back to deriving from `placement` via toAbsolute.
  const [dragPos, setDragPos] = useState<Point | null>(null);
  const [liveSize, setLiveSize] = useState<Size | null>(null);
  const [pointerPos, setPointerPos] = useState<Point | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  // The pointer that started the active drag/resize. On touch, a second
  // finger produces its own pointer events on the window listeners — without
  // this filter it would teleport the overlay or end the gesture.
  const activePointerIdRef = useRef<number | null>(null);

  // Drag-only bookkeeping kept in refs (not state) so handleDragMove/
  // handleDragEnd have stable identities during the gesture — otherwise the
  // window listener effect below would tear down and re-subscribe three
  // listeners on every single pointermove.
  const dragStartClientRef = useRef<Point | null>(null);
  const dragOffsetRef = useRef<Point>({ x: 0, y: 0 });
  const dragPosRef = useRef<Point | null>(null);
  // A pointerdown "arms" the gesture (isPointerDown), but it only becomes a
  // real drag — dock zones shown, cursor changes, card follows the pointer —
  // once movement exceeds DRAG_THRESHOLD_PX. Below that, pointerdown+pointerup
  // is a plain click on the header (e.g. to focus/select) and leaves
  // placement untouched.
  const hasCrossedDragThresholdRef = useRef(false);
  const [isPointerDown, setIsPointerDown] = useState(false);

  const pipRef = useRef<HTMLDivElement>(null);

  // Position is derived (toAbsolute), so viewport changes only need to
  // re-clamp size — the old dedicated position-clamp effect is gone.
  const recomputeViewport = useCallback(() => {
    const vp = region ? regionViewport(region) : computeViewport(state.isConnected, chromeBottom);
    setViewport(vp);
    // Too-small column: the pill shows; don't shrink (and persist) the card.
    if (region && !regionFitsCard(region)) return;
    setPlacement(prev => {
      const clampedSize = clampSizeToViewport(prev.size, vp);
      if (clampedSize.width === prev.size.width && clampedSize.height === prev.size.height) {
        return prev;
      }
      const next = { ...prev, size: clampedSize };
      setCachedItem(storageKey, next);
      return next;
    });
  }, [state.isConnected, chromeBottom, region, storageKey]);

  // Re-derive on mount and whenever the voice bar's presence (or the
  // bottom chrome's height) changes.
  useEffect(() => {
    recomputeViewport();
  }, [recomputeViewport]);

  // Context (state.pipCollapsed) is the single source of truth for
  // collapsed/expanded — it can change from outside this component (e.g. the
  // VoiceBottomBar settings menu, or auto-reveal while this component isn't
  // even mounted). Keep the local placement's collapsed field in sync so
  // this component's own writes (resize, drag, viewport clamp) don't clobber
  // it with a stale value — persistence itself is handled by a
  // provider-level effect in VoiceContext so it applies even when FloatCard
  // isn't mounted (e.g. the embedded stage is showing).
  useEffect(() => {
    setPlacement(prev => (prev.collapsed === state.pipCollapsed ? prev : { ...prev, collapsed: state.pipCollapsed }));
  }, [state.pipCollapsed]);

  useEffect(() => {
    // Column mode re-derives from the region store, which already tracks resizes.
    if (regionMode) return;
    window.addEventListener('resize', recomputeViewport);
    return () => window.removeEventListener('resize', recomputeViewport);
  }, [recomputeViewport, regionMode]);

  // Drag handlers. handleDragStart only "arms" the gesture (isPointerDown) —
  // it doesn't show dock zones or move the card yet. handleDragMove promotes
  // it to a real drag (isDragging) the first time movement crosses
  // DRAG_THRESHOLD_PX; below that, releasing the pointer is a no-op click.
  const handleDragStart = useCallback((e: React.PointerEvent) => {
    if (activePointerIdRef.current !== null) return;
    e.preventDefault();
    activePointerIdRef.current = e.pointerId;
    dragStartClientRef.current = { x: e.clientX, y: e.clientY };
    hasCrossedDragThresholdRef.current = false;
    const abs = toAbsolute(placement, viewport);
    dragOffsetRef.current = { x: e.clientX - abs.x, y: e.clientY - abs.y };
    setIsPointerDown(true);
  }, [placement, viewport]);

  // Reads bookkeeping from refs only, so this callback's identity never
  // changes — the window listener effect below doesn't need to re-subscribe
  // on every pointermove.
  const handleDragMove = useCallback((e: PointerEvent) => {
    if (e.pointerId !== activePointerIdRef.current) return;
    if (!hasCrossedDragThresholdRef.current) {
      const start = dragStartClientRef.current;
      if (!start) return;
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (moved < DRAG_THRESHOLD_PX) return;
      hasCrossedDragThresholdRef.current = true;
      setIsDragging(true);
    }
    const offset = dragOffsetRef.current;
    const nextPos = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    dragPosRef.current = nextPos;
    setDragPos(nextPos);
    setPointerPos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleDragEnd = useCallback((e: PointerEvent) => {
    if (e.pointerId !== activePointerIdRef.current) return;
    activePointerIdRef.current = null;
    setIsPointerDown(false);
    const wasDragging = hasCrossedDragThresholdRef.current;
    hasCrossedDragThresholdRef.current = false;
    dragStartClientRef.current = null;
    // Never crossed the threshold — a plain click. Nothing moved, nothing to
    // persist, and isDragging was never set so there's no state to unwind.
    if (!wasDragging) return;
    setIsDragging(false);
    setPointerPos(null);
    const dropPos = dragPosRef.current;
    dragPosRef.current = null;
    setDragPos(null);
    if (!dropPos) return;
    // Dock decision is made off the pointer's drop location, not the card's
    // position — matches the highlighted zone the user was looking at.
    const zone = hitTestDockZone({ x: e.clientX, y: e.clientY }, viewport);
    const nextPlacement: PipPlacement = zone
      ? { ...placement, anchor: zone, offset: { x: 0, y: 0 }, docked: true }
      : { ...placement, ...fromAbsolute(dropPos, placement.size, viewport), docked: false };
    setPlacement(nextPlacement);
    setCachedItem(storageKey, nextPlacement);
  }, [placement, viewport, storageKey]);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    if (activePointerIdRef.current !== null) return;
    e.preventDefault();
    e.stopPropagation();
    activePointerIdRef.current = e.pointerId;
    // Freeze the top-left corner for the gesture; only size tracks the
    // pointer, so the card grows toward the bottom-right handle in place.
    setDragPos(toAbsolute(placement, viewport));
    setLiveSize(placement.size);
    setResizeStart({ x: e.clientX, y: e.clientY, width: placement.size.width, height: placement.size.height });
    setIsResizing(true);
  }, [placement, viewport]);

  const handleResizeMove = useCallback((e: PointerEvent) => {
    if (e.pointerId !== activePointerIdRef.current) return;
    const deltaX = e.clientX - resizeStart.x;
    const deltaY = e.clientY - resizeStart.y;
    setLiveSize(clampSizeToViewport(
      { width: resizeStart.width + deltaX, height: resizeStart.height + deltaY },
      viewport
    ));
  }, [resizeStart, viewport]);

  const handleResizeEnd = useCallback((e: PointerEvent) => {
    if (e.pointerId !== activePointerIdRef.current) return;
    activePointerIdRef.current = null;
    if (!isResizing) return;
    setIsResizing(false);
    const finalSize = liveSize;
    const frozenPos = dragPos;
    setLiveSize(null);
    setDragPos(null);
    if (!finalSize || !frozenPos) return;
    // Docked: keep the anchor, just store the new size (position re-derives
    // from the anchor). Free: recompute the anchor/offset from the frozen
    // top-left so the card doesn't jump on the next render.
    const nextPlacement: PipPlacement = placement.docked
      ? { ...placement, size: finalSize }
      : { ...placement, size: finalSize, ...fromAbsolute(frozenPos, finalSize, viewport) };
    setPlacement(nextPlacement);
    setCachedItem(storageKey, nextPlacement);
  }, [isResizing, liveSize, dragPos, placement, viewport, storageKey]);

  // Global pointer event listeners for drag/resize (pointer events unify mouse
  // and touch, so this works for touch tablets as well as mouse users)
  useEffect(() => {
    // Listeners attach for the whole pointerdown->pointerup span (not just
    // once isDragging flips true) so movement below DRAG_THRESHOLD_PX can
    // still be observed and promoted into a drag.
    if (isPointerDown) {
      window.addEventListener('pointermove', handleDragMove);
      window.addEventListener('pointerup', handleDragEnd);
      // Touch can end with pointercancel (OS gesture / scroll takeover);
      // without this the drag state would stick.
      window.addEventListener('pointercancel', handleDragEnd);
      return () => {
        window.removeEventListener('pointermove', handleDragMove);
        window.removeEventListener('pointerup', handleDragEnd);
        window.removeEventListener('pointercancel', handleDragEnd);
      };
    }
  }, [isPointerDown, handleDragMove, handleDragEnd]);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('pointermove', handleResizeMove);
      window.addEventListener('pointerup', handleResizeEnd);
      window.addEventListener('pointercancel', handleResizeEnd);
      return () => {
        window.removeEventListener('pointermove', handleResizeMove);
        window.removeEventListener('pointerup', handleResizeEnd);
        window.removeEventListener('pointercancel', handleResizeEnd);
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  // Toggle collapse (card <-> pill). Source of truth is context
  // (state.pipCollapsed); VoiceProvider persists the change.
  const toggleCollapsed = useCallback(() => {
    actions.setPipCollapsed(!state.pipCollapsed);
  }, [actions, state.pipCollapsed]);

  const displayName = state.contextType === VoiceSessionType.Dm
    ? state.dmGroupName || 'DM Call'
    : state.channelName || 'Voice';

  const participantCount = (state.room?.remoteParticipants.size ?? 0) + 1;

  // Navigate back to the session's stage. Skipped when there's nowhere to go
  // (no route resolvable) or the stage is already mounted (nothing to float over).
  const handleCardClick = useCallback(() => {
    if (state.stageMounted) return;
    const target = getFloatNavigationTarget(state);
    if (!target) return;
    navigate(target);
  }, [state, navigate]);

  // Minimized view (pill) — also when the message column is too small for
  // the card; then a click opens the call instead of expanding the card.
  if (state.pipCollapsed || forcePill) {
    const pillPos = toAbsolute(placement, viewport, PILL_SIZE);
    return (
      <Paper
        ref={pipRef}
        data-testid="float-card-pill"
        elevation={8}
        sx={{
          position: 'fixed',
          left: pillPos.x,
          top: pillPos.y,
          zIndex: 1200,
          borderRadius: 2,
          overflow: 'hidden',
          cursor: 'pointer',
          transition: 'transform 0.2s',
          '&:hover': {
            transform: 'scale(1.05)',
          },
        }}
        onClick={forcePill && !state.pipCollapsed ? handleCardClick : toggleCollapsed}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: 1,
            backgroundColor: theme.palette.background.paper,
          }}
        >
          <Badge badgeContent={participantCount} color="primary">
            <People />
          </Badge>
          <Typography variant="body2" fontWeight="medium" noWrap sx={{ minWidth: 0, maxWidth: 140 }}>
            {displayName}
          </Typography>
          <Tooltip title="Expand">
            <IconButton size="small">
              <OpenInFull fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Paper>
    );
  }

  const isLocalSelection = !!selection && state.room?.localParticipant === selection.participant;
  const renderedPos = dragPos ?? toAbsolute(placement, viewport);
  const renderedSize = liveSize ?? placement.size;

  return (
    <>
      {/* Always mounted (not gated on isDragging) so its Fade can play the
          exit transition on drag end instead of being torn out instantly. */}
      <DockZonesOverlay viewport={viewport} pointerPosition={pointerPos} isDragging={isDragging} />
      <Paper
        ref={pipRef}
        elevation={8}
        onMouseEnter={() => setIsCardHovered(true)}
        onMouseLeave={() => setIsCardHovered(false)}
        sx={{
          position: 'fixed',
          left: renderedPos.x,
          top: renderedPos.y,
          width: renderedSize.width,
          height: renderedSize.height,
          zIndex: 1200,
          borderRadius: 2,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          border: `1px solid ${theme.palette.divider}`,
          userSelect: isDragging || isResizing ? 'none' : 'auto',
        }}
      >
        {/* Header - Draggable */}
        <Box
          sx={{
            height: HEADER_HEIGHT,
            backgroundColor: alpha(theme.palette.background.paper, 0.95),
            borderBottom: `1px solid ${theme.palette.divider}`,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1,
            cursor: isDragging ? 'grabbing' : 'grab',
            flexShrink: 0,
            // Prevent the browser treating a touch-drag on the header as a scroll
            touchAction: 'none',
          }}
          onPointerDown={handleDragStart}
        >
          <DragIndicator fontSize="small" sx={{ color: 'text.secondary' }} />
          <Typography variant="caption" fontWeight="medium" noWrap sx={{ minWidth: 0, flex: 1 }}>
            {displayName}
          </Typography>
        </Box>

        {/* Video Content — single tile from useFloatTileSelection */}
        <Box
          data-testid="float-card-body"
          sx={{ flex: 1, overflow: 'hidden', minHeight: 0, position: 'relative', cursor: 'pointer' }}
          onClick={handleCardClick}
        >
          {!selection ? null : selection.kind === 'avatar' ? (
            // Avatar + name stacked in the middle of the tile; the bottom
            // padding keeps the name clear of the control strip, which is
            // always visible on touch.
            <Box
              sx={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                px: 1.5,
                pb: 6,
                pt: 1,
                boxSizing: 'border-box',
                backgroundColor: 'grey.800',
              }}
            >
              <Box sx={{ height: 'min(120px, 60%)', aspectRatio: '1 / 1', flexShrink: 1, minHeight: 32 }}>
                <UserAvatar userId={selection.participant.identity} displayName={selection.participant.name} size="fluid" />
              </Box>
              <Box data-testid="float-card-avatar-label" sx={{ maxWidth: '100%', minWidth: 0, display: 'flex' }}>
                <Typography
                  variant="caption"
                  noWrap
                  sx={{ color: 'white', fontWeight: 'bold', textShadow: '1px 1px 2px rgba(0,0,0,0.8)', minWidth: 0 }}
                >
                  {selection.participant.name || selection.participant.identity}
                  {isLocalSelection && ' (You)'}
                </Typography>
              </Box>
            </Box>
          ) : (
            <VideoTile
              participant={selection.participant}
              videoTrack={selection.kind === 'camera' ? selection.publication : undefined}
              screenTrack={selection.kind === 'screen' ? selection.publication : undefined}
              isLocal={isLocalSelection}
              isReplayBufferActive={isReplayBufferActive}
            />
          )}

          {/* Hover control strip — mirrors VoiceBottomBar's mic/camera actions */}
          <Box
            className="pip-controls"
            data-testid="float-card-controls"
            onClick={(e) => e.stopPropagation()}
            sx={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              display: 'flex',
              justifyContent: 'center',
              gap: 1,
              p: 1,
              backgroundImage: `linear-gradient(transparent, ${alpha(theme.palette.common.black, 0.6)})`,
              opacity: isCardHovered ? 1 : 0,
              transition: 'opacity 0.15s ease',
              '@media (hover: none)': {
                opacity: 1,
              },
              // Touch: 36px buttons plus a 4px invisible outset each (the gap
              // is 8px), so every control is a 44px tap target.
              '@media (pointer: coarse)': {
                '& .MuiIconButton-root': {
                  width: FLOAT_TOUCH_BUTTON,
                  height: FLOAT_TOUCH_BUTTON,
                  '&::after': {
                    content: '""',
                    position: 'absolute',
                    inset: -(TOUCH_TARGETS.MINIMUM - FLOAT_TOUCH_BUTTON) / 2,
                  },
                },
              },
            }}
          >
            <Tooltip
              title={
                micBlocked
                  ? publish.speakBlockedReason
                  : isPTTActive ? 'Push-to-talk active' : isMicrophoneEnabled ? 'Mute' : 'Unmute'
              }
            >
              <span>
              <IconButton
                size="small"
                aria-label={micBlocked ? publish.speakBlockedReason : isMicrophoneEnabled ? 'Mute' : 'Unmute'}
                disabled={micBlocked}
                onClick={micGuarded ? undefined : actions.toggleMute}
                sx={{
                  backgroundColor: alpha(theme.palette.background.paper, 0.7),
                  color: !isMicrophoneEnabled ? theme.palette.error.main : theme.palette.text.primary,
                  cursor: micGuarded ? 'default' : 'pointer',
                }}
              >
                {isMicrophoneEnabled ? <Mic fontSize="small" /> : <MicOff fontSize="small" />}
              </IconButton>
              </span>
            </Tooltip>
            <Tooltip
              title={
                cameraBlocked
                  ? publish.videoBlockedReason
                  : isCameraEnabled ? 'Turn off camera' : 'Turn on camera'
              }
            >
              <span>
              <IconButton
                size="small"
                aria-label={
                  cameraBlocked
                    ? publish.videoBlockedReason
                    : isCameraEnabled ? 'Turn off camera' : 'Turn on camera'
                }
                disabled={cameraBlocked}
                onClick={actions.toggleVideo}
                sx={{
                  backgroundColor: alpha(theme.palette.background.paper, 0.7),
                  color: isCameraEnabled ? theme.palette.primary.main : theme.palette.text.primary,
                }}
              >
                {isCameraEnabled ? <Videocam fontSize="small" /> : <VideocamOff fontSize="small" />}
              </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Minimize">
              <IconButton
                size="small"
                onClick={toggleCollapsed}
                sx={{
                  backgroundColor: alpha(theme.palette.background.paper, 0.7),
                  color: theme.palette.text.primary,
                }}
              >
                <Minimize fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Resize Handle */}
        <Box
          sx={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 20,
            height: 20,
            cursor: 'se-resize',
            touchAction: 'none',
            '&::after': {
              content: '""',
              position: 'absolute',
              right: 4,
              bottom: 4,
              width: 8,
              height: 8,
              borderRight: `2px solid ${theme.palette.text.secondary}`,
              borderBottom: `2px solid ${theme.palette.text.secondary}`,
            },
          }}
          onPointerDown={handleResizeStart}
        />
      </Paper>
    </>
  );
};

export default FloatCard;
