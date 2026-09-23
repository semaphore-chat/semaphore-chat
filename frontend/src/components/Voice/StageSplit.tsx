import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Box } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { getCachedItem, setCachedItem } from '../../utils/storage';

interface StageSplitProps {
  top: React.ReactNode;
  bottom: React.ReactNode;
  /** localStorage key the split ratio is persisted under (e.g. 'semaphore_dm_stage_ratio') */
  storageKey: string;
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
}

const clampRatio = (ratio: number, min: number, max: number) => Math.min(max, Math.max(min, ratio));

/** Reusable vertical split container (top/bottom panes with a drag-to-resize divider). */
export const StageSplit: React.FC<StageSplitProps> = ({
  top,
  bottom,
  storageKey,
  defaultRatio = 0.5,
  minRatio = 0.2,
  maxRatio = 0.8,
}) => {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  // Pointer drag pattern mirrors PersistentVideoOverlay.tsx: a single-pointer
  // guard so only the pointer that started the drag can drive/end it.
  const activePointerIdRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [ratio, setRatio] = useState<number>(() => {
    const cached = getCachedItem<number>(storageKey);
    if (typeof cached === 'number' && !Number.isNaN(cached)) {
      return clampRatio(cached, minRatio, maxRatio);
    }
    return defaultRatio;
  });
  // Read during pointer-up without adding `ratio` to the up-handler's deps
  // (which would otherwise force the drag listener effect to re-subscribe
  // on every move).
  const ratioRef = useRef(ratio);
  useEffect(() => {
    ratioRef.current = ratio;
  }, [ratio]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (activePointerIdRef.current !== null) return;
    e.preventDefault();
    activePointerIdRef.current = e.pointerId;
    setIsDragging(true);
  }, []);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (e.pointerId !== activePointerIdRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.height === 0) return;
    setRatio(clampRatio((e.clientY - rect.top) / rect.height, minRatio, maxRatio));
  }, [minRatio, maxRatio]);

  const handlePointerUp = useCallback((e: PointerEvent) => {
    if (e.pointerId !== activePointerIdRef.current) return;
    activePointerIdRef.current = null;
    setIsDragging(false);
    // Persist on release only — writing to storage on every pointermove would
    // thrash localStorage during a drag.
    setCachedItem(storageKey, ratioRef.current);
  }, [storageKey]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    let delta = 0;
    if (e.key === 'ArrowUp') delta = -0.05;
    else if (e.key === 'ArrowDown') delta = 0.05;
    else return;
    e.preventDefault();
    // Round to avoid binary floating-point drift (0.5 + 0.05 !== 0.55) from
    // repeated key presses showing up in flexBasis/aria-valuenow.
    const next = clampRatio(Math.round((ratioRef.current + delta) * 1000) / 1000, minRatio, maxRatio);
    setRatio(next);
    // Keyboard adjustments persist immediately (unlike drag, there's no
    // continuous move stream to debounce against).
    setCachedItem(storageKey, next);
  }, [minRatio, maxRatio, storageKey]);

  useEffect(() => {
    if (!isDragging) return;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isDragging, handlePointerMove, handlePointerUp]);

  return (
    <Box
      ref={containerRef}
      data-testid="stage-split-container"
      sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      <Box
        data-testid="stage-split-top"
        // Round to hundredths of a percent — `ratio * 100` alone can surface
        // binary floating-point noise (e.g. 0.55 * 100 === 55.00000000000001)
        // for ratios reached via keyboard increments.
        sx={{ flexBasis: `${Math.round(ratio * 10000) / 100}%`, minHeight: 0, overflow: 'hidden' }}
      >
        {top}
      </Box>
      <Box
        data-testid="stage-split-divider"
        role="separator"
        aria-orientation="horizontal"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(minRatio * 100)}
        aria-valuemax={Math.round(maxRatio * 100)}
        aria-label="Resize video area"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        sx={{
          height: 8,
          flexShrink: 0,
          cursor: 'row-resize',
          touchAction: 'none',
          backgroundColor: isDragging ? alpha(theme.palette.primary.main, 0.3) : 'transparent',
          '&:hover': {
            backgroundColor: alpha(theme.palette.primary.main, 0.2),
          },
          '&:focus-visible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: -2,
          },
        }}
      />
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {bottom}
      </Box>
    </Box>
  );
};

export default StageSplit;
