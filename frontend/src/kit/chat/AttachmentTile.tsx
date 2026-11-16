import { useState, type JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { mix } from '../theme/mix';
import { focusRing } from '../theme/states';
import { standOutFill, tintBase, useSurface, type Surface } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';
import { Icon } from '../display/Icon';
import { Spinner } from '../display/Spinner';
import { LinearProgress } from '../display/LinearProgress';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { useRowTabIndex } from './rowTabScope';
import { IMAGE_MAX, IMAGE_MIN_SIDE, imageBox } from './attachmentBox';

export interface AttachmentTileProps {
  /** `image`: a picture, drawn in a box of its known size. `file`: a row with the file's name and size. */
  kind: 'image' | 'file';
  /** The file's name. Read, and shown on a file (and on an image that cannot be drawn). */
  name: string;
  /** The size, written for people ("2.4 MB"). */
  detail?: string;
  /**
   * The picture to draw (a preview of an image). Until it is known the box shows a quiet fill. On a `file` it is a
   * small thumbnail in place of the paperclip (a queued picture in the composer's tray).
   */
  src?: string;
  /** The image's own width and height in pixels: the box is sized from them before the picture arrives. */
  width?: number | null;
  height?: number | null;
  /** Opens the image (a new tab), or downloads the file. Without it the tile is not pressable (a queued file). */
  onOpen?: () => void;
  /** The open or download is on its way: busy, presses ignored. */
  busy?: boolean;
  /** Shows a Remove button beside the tile ("Remove notes.txt"): a queued file, or an upload to cancel. */
  onRemove?: () => void;
  /** The upload is this far, 0 to 100: a bar under the tile ("Uploading notes.txt"). */
  progress?: number;
  /** The upload failed: this text, in the danger tone, in place of `detail`. */
  error?: string;
  /** With `error`: a Retry button ("Retry uploading notes.txt"). */
  onRetry?: () => void;
}

const pressable = (palette: ReturnType<typeof kitTheme>['palette']) => ({
  margin: 0,
  border: 'none',
  cursor: 'pointer',
  outline: 'none',
  '&:focus-visible': focusRing(palette, 0),
  '&[aria-busy="true"]': { cursor: 'progress' },
});

const ImageButton = styled('button', { shouldForwardProp: transientProps })<{ $on: Surface; $w: number; $h: number }>(
  ({ theme, $on, $w, $h }) => {
    const { palette } = kitTheme(theme);
    return {
      ...pressable(palette),
      position: 'relative',
      display: 'block',
      padding: 0,
      // The box is fixed before the picture loads (its aspect ratio holds as it shrinks), so the list never shifts.
      width: `${$w}px`,
      maxWidth: '100%',
      aspectRatio: `${$w} / ${$h}`,
      // A narrow column shrinks the box with its shape, but never under the smallest side (the picture letterboxes).
      minHeight: `${IMAGE_MIN_SIDE}px`,
      overflow: 'hidden',
      borderRadius: `${tokens.radius.md}px`,
      background: standOutFill(palette, $on),
    };
  },
);

const Picture = styled('img')({
  display: 'block',
  width: '100%',
  height: '100%',
  // Contain: an extreme shape is letterboxed in its (clamped) box, never cropped to a sliver.
  objectFit: 'contain',
});

const Centred = styled('span')(({ theme }) => {
  const { palette } = kitTheme(theme);
  return {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: `${tokens.space.xs}px`,
    padding: `${tokens.space.sm}px`,
    color: palette.textSecondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${tokens.text.small.size}px`,
    lineHeight: `${tokens.text.small.line}px`,
    overflowWrap: 'anywhere',
    textAlign: 'center',
  };
});

const FileButton = styled('button', { shouldForwardProp: transientProps })<{ $on: Surface }>(({ theme, $on }) => {
  const { palette } = kitTheme(theme);
  return {
    ...pressable(palette),
    display: 'flex',
    alignItems: 'center',
    gap: `${tokens.space.md}px`,
    width: '100%',
    maxWidth: `${IMAGE_MAX.width}px`,
    boxSizing: 'border-box',
    padding: `${tokens.space.sm}px ${tokens.space.md}px`,
    borderRadius: `${tokens.radius.md}px`,
    background: standOutFill(palette, $on),
    color: palette.text,
    textAlign: 'start',
    fontFamily: theme.typography.fontFamily,
    '@media (hover: hover)': { '&:hover': { background: mix(palette.text, tintBase(palette, $on), tokens.state.hover) } },
  };
});

/** A queued picture's thumbnail in a file row, in the paperclip's place. */
const Thumb = styled('img')({
  flex: `0 0 ${tokens.avatar.md}px`,
  width: `${tokens.avatar.md}px`,
  height: `${tokens.avatar.md}px`,
  objectFit: 'cover',
  borderRadius: `${tokens.radius.sm}px`,
});

/** The tile and its Remove button, with the progress bar or the failure under them. */
const Wrap = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  gap: `${tokens.space.xs}px`,
  minWidth: 0,
  maxWidth: `${IMAGE_MAX.width}px`,
  width: '100%',
});

const Line = styled('div')({ display: 'flex', alignItems: 'center', gap: `${tokens.space.xs}px`, minWidth: 0 });

const Failure = styled('div')(({ theme }) => ({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: `${tokens.space.sm}px`,
  color: kitTheme(theme).palette.danger,
  fontFamily: theme.typography.fontFamily,
  fontSize: `${tokens.text.small.size}px`,
  lineHeight: `${tokens.text.small.line}px`,
  overflowWrap: 'anywhere',
}));

const FileText = styled('span')({ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' });

const FileName = styled('span')({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: `${tokens.text.body.size}px`,
  lineHeight: `${tokens.text.body.line}px`,
});

const FileDetail = styled('span')(({ theme }) => ({
  fontSize: `${tokens.text.small.size}px`,
  lineHeight: `${tokens.text.small.line}px`,
  color: kitTheme(theme).palette.textSecondary,
}));

/**
 * A file sent with a message (`MessageRow`'s `attachments`), or one on its way: queued in the composer's tray
 * (`onRemove`, no `onOpen`) or uploading under a pending message (`progress`, `error` with `onRetry`). An image is drawn in a box sized from its known
 * width and height before the picture arrives, so a late picture never moves the list; pressing it opens the image.
 * Any other file (video and audio too, until they have players) is a row with its name and size; pressing it
 * downloads the file.
 */
export function AttachmentTile({ onRemove, progress, error, onRetry, ...tile }: AttachmentTileProps): JSX.Element {
  if (onRemove === undefined && progress === undefined && error === undefined) return <Tile {...tile} />;
  const { name } = tile;
  return (
    <Wrap>
      <Line>
        <Tile {...tile} detail={error === undefined ? tile.detail : undefined} />
        {onRemove !== undefined && (
          <IconButton icon="X" size="sm" variant="ghost" label={`Remove ${name}`} onClick={onRemove} />
        )}
      </Line>
      {error !== undefined ? (
        <Failure>
          <span>{error}</span>
          {onRetry !== undefined && (
            <Button variant="text" size="sm" aria-label={`Retry uploading ${name}`} onClick={onRetry}>
              Retry
            </Button>
          )}
        </Failure>
      ) : progress !== undefined ? (
        <LinearProgress label={`Uploading ${name}`} value={progress} />
      ) : null}
    </Wrap>
  );
}

function Tile({
  kind,
  name,
  detail,
  src,
  width,
  height,
  onOpen,
  busy = false,
}: Omit<AttachmentTileProps, 'onRemove' | 'progress' | 'error' | 'onRetry'>): JSX.Element {
  const on = useSurface();
  const tabIndex = useRowTabIndex();
  const [failed, setFailed] = useState(false);
  const press = () => {
    if (!busy) onOpen?.();
  };
  const pressable = onOpen !== undefined;
  if (!pressable) {
    // A queued file: a row with its thumbnail (a picture) or the paperclip, its name and size; nothing to press.
    return (
      <FileButton as="div" role="group" aria-label={`${name}${detail ? `, ${detail}` : ''}`} $on={on}>
        {src !== undefined ? <Thumb src={src} alt="" /> : <Icon name="Paperclip" size="md" tone="secondary" />}
        <FileText aria-hidden="true">
          <FileName dir="auto">{name}</FileName>
          {detail !== undefined && <FileDetail>{detail}</FileDetail>}
        </FileText>
      </FileButton>
    );
  }
  if (kind === 'image') {
    const box = imageBox(width, height);
    return (
      <ImageButton
        type="button"
        tabIndex={tabIndex}
        aria-label={`Open image ${name}`}
        aria-busy={busy || undefined}
        onClick={press}
        $on={on}
        $w={box.width}
        $h={box.height}
      >
        {src !== undefined && !failed ? (
          <Picture src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
        ) : failed ? (
          <Centred>
            <Icon name="Image" size="sm" />
            <span dir="auto">{name}</span>
          </Centred>
        ) : null}
        {busy && (
          <Centred>
            <Spinner size="md" />
          </Centred>
        )}
      </ImageButton>
    );
  }
  return (
    <FileButton
      type="button"
      tabIndex={tabIndex}
      aria-label={`Download ${name}${detail ? `, ${detail}` : ''}`}
      aria-busy={busy || undefined}
      onClick={press}
      $on={on}
    >
      {src !== undefined ? <Thumb src={src} alt="" /> : <Icon name="Paperclip" size="md" tone="secondary" />}
      <FileText aria-hidden="true">
        <FileName dir="auto">{name}</FileName>
        {detail !== undefined && <FileDetail>{detail}</FileDetail>}
      </FileText>
      {busy && <Spinner size="sm" />}
    </FileButton>
  );
}
