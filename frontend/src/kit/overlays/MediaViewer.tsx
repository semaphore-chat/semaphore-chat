import { stripBidi } from '../../utils/bidi';
import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { transientProps } from '../theme/transientProps';
import { IconButton } from '../controls/IconButton';
import { Icon } from '../display/Icon';
import { Spinner } from '../display/Spinner';
import { Modal, type SheetCloseReason } from './modal';
import { SAFE_BOTTOM } from './modalParts';

/** Why the viewer closes: Escape, a press beside the picture (`'scrim'`), Close (`'button'`), or its parent layer closed. */
export type MediaViewerCloseReason = SheetCloseReason;

export interface MediaViewerItem {
  /** The full-size picture. Until it is known the viewer shows a spinner. */
  src?: string;
  /** The file's name: the viewer's heading. */
  name: string;
  /** What the picture shows, for a screen reader. Default: the name. */
  alt?: string;
  /** The picture could not be loaded. */
  failed?: boolean;
}

export interface MediaViewerProps {
  open: boolean;
  /** Called on Escape, on a press beside the picture, on Close, and when the layer it was opened from closes. */
  onClose: (reason: MediaViewerCloseReason) => void;
  /** The pictures it steps through, in order. */
  items: readonly MediaViewerItem[];
  /** Which one shows. */
  index: number;
  /** Previous or Next (the buttons, ← and →, a swipe) asked for another one. */
  onIndexChange: (index: number) => void;
  /** A Download button for the one showing. */
  onDownload?: () => void;
  /** The download is on its way: Download is busy (still focusable). */
  downloading?: boolean;
}

/** A sideways swipe at least this long, and more sideways than up or down, steps to the next or previous picture. */
const SWIPE_MIN = tokens.space['3xl'];

const Bar = styled('div')({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: `${tokens.space.sm}px`,
  minWidth: 0,
  padding: `max(${tokens.space.sm}px, env(safe-area-inset-top)) ${tokens.space.sm}px ${tokens.space.sm}px ${tokens.space.lg}px`,
});

const Heading = styled('h2')(({ theme }) => ({
  flex: '1 1 auto',
  minWidth: 0,
  margin: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: kitTheme(theme).palette.text,
  fontFamily: theme.typography.fontFamily,
  fontSize: `${tokens.text.bodyStrong.size}px`,
  lineHeight: `${tokens.text.bodyStrong.line}px`,
  fontWeight: tokens.text.bodyStrong.weight,
}));

const Count = styled('span')(({ theme }) => ({
  flex: '0 0 auto',
  color: kitTheme(theme).palette.textSecondary,
  fontFamily: theme.typography.fontFamily,
  fontSize: `${tokens.text.meta.size}px`,
  lineHeight: `${tokens.text.meta.line}px`,
  fontVariantNumeric: 'tabular-nums',
}));

const Stage = styled('div')({
  position: 'relative',
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: `0 ${tokens.space.sm}px calc(${tokens.space.sm}px + ${SAFE_BOTTOM})`,
  // Pinch zoom stays the browser's; a one-finger swipe is the viewer's.
  touchAction: 'pinch-zoom',
});

const Picture = styled('img')({
  display: 'block',
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
  userSelect: 'none',
});

const Failed = styled('div')(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: `${tokens.space.sm}px`,
  color: kitTheme(theme).palette.textSecondary,
  fontFamily: theme.typography.fontFamily,
  fontSize: `${tokens.text.meta.size}px`,
  lineHeight: `${tokens.text.meta.line}px`,
}));

/** Takes no box of its own: it only hears the arrow keys of everything in the viewer. */
const Keys = styled('div')({ display: 'contents' });

/** Previous and Next, over the picture at its sides. */
const Side = styled('div', { shouldForwardProp: transientProps })<{ $side: 'start' | 'end' }>(({ $side }) => ({
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  [$side === 'start' ? 'insetInlineStart' : 'insetInlineEnd']: `${tokens.space.sm}px`,
}));

/**
 * A message's pictures, one at a time, filling the screen: the name and "2 of 5" on top with Download and Close,
 * the picture as large as fits, Previous and Next at its sides. ← and → step (as do the buttons and a sideways
 * swipe), Escape and Close close, and so does a press beside the picture. It is a modal layer like Dialog: focus
 * starts on Close, is held inside, and returns to what opened it.
 */
export function MediaViewer({
  open,
  onClose,
  items,
  index,
  onIndexChange,
  onDownload,
  downloading = false,
}: MediaViewerProps): JSX.Element {
  const titleId = `${useId()}-title`;
  const close = useRef<HTMLButtonElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  // Fingers down now, and whether this gesture ever had two (a pinch is the browser's zoom, never a swipe).
  const pointers = useRef(new Set<number>());
  const pinched = useRef(false);
  const count = items.length;
  const at = Math.min(Math.max(0, index), Math.max(0, count - 1));
  const item = items[at] as MediaViewerItem | undefined;
  const name = stripBidi(item?.name ?? '');
  const [broken, setBroken] = useState<string | null>(null);
  const hasPrevious = at > 0;
  const hasNext = at < count - 1;
  useEffect(() => {
    if (open) requestAnimationFrame(() => close.current?.focus());
  }, [open]);
  const step = (by: -1 | 1) => {
    const next = at + by;
    if (next >= 0 && next < count) onIndexChange(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    // In a right-to-left page the picture before is on the right.
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      step((event.key === 'ArrowRight') !== rtl ? 1 : -1);
    }
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // A mouse never swipes or pinches, and its release can land off the stage: it is not counted.
    if (event.pointerType === 'mouse') {
      swipe.current = null;
      return;
    }
    if (pointers.current.size === 0) pinched.current = false;
    pointers.current.add(event.pointerId);
    if (pointers.current.size > 1) pinched.current = true;
    swipe.current = pinched.current ? null : { x: event.clientX, y: event.clientY };
  };
  const endPointer = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    endPointer(event);
    const start = swipe.current;
    swipe.current = null;
    if (start === null || pinched.current) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) <= Math.abs(dy)) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    step((dx < 0) !== rtl ? 1 : -1);
  };
  const failed = item?.failed === true || (item?.src !== undefined && broken === item.src);
  return (
    <Modal
      kind="dialog"
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      container={{ padding: 0 }}
      panel={(theme) => {
        const { palette } = kitTheme(theme);
        return {
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          maxWidth: '100%',
          maxHeight: '100%',
          margin: 0,
          borderRadius: 0,
          background: palette.ground,
          backgroundImage: 'none',
          boxShadow: 'none',
          color: palette.text,
          outline: 'none',
        };
      }}
    >
      <Keys onKeyDown={onKeyDown}>
        <Bar>
          <Heading id={titleId} dir="auto">
            {name}
          </Heading>
          {count > 1 && <Count>{`${at + 1} of ${count}`}</Count>}
          {onDownload !== undefined && (
            <IconButton icon="Download" label={`Download ${name}`} variant="ghost" loading={downloading} onClick={onDownload} />
          )}
          <IconButton ref={close} icon="X" label="Close" variant="ghost" onClick={() => onClose('button')} />
        </Bar>
        <Stage
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={(event) => {
            endPointer(event);
            swipe.current = null;
          }}
          // A finger whose release the stage never hears (capture lost, left the stage) is no longer down.
          onLostPointerCapture={endPointer}
          onPointerLeave={endPointer}
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose('scrim');
          }}
        >
          {item === undefined ? null : failed ? (
            <Failed>
              <Icon name="Image" size="lg" />
              <span>{"Couldn't load the picture"}</span>
            </Failed>
          ) : item.src !== undefined ? (
            <Picture key={item.src} src={item.src} alt={item.alt ?? name} draggable={false} onError={() => setBroken(item.src ?? null)} />
          ) : (
            <Spinner size="lg" label={`Loading ${name}`} />
          )}
          {count > 1 && (
            <>
              {/* At either end the button stays (unavailable), so focus on it is never dropped. */}
              <Side $side="start">
                <IconButton icon="ChevronLeft" label="Previous picture" variant="soft" aria-disabled={!hasPrevious} onClick={() => step(-1)} />
              </Side>
              <Side $side="end">
                <IconButton icon="ChevronRight" label="Next picture" variant="soft" aria-disabled={!hasNext} onClick={() => step(1)} />
              </Side>
            </>
          )}
        </Stage>
      </Keys>
    </Modal>
  );
}
