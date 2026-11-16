import {
  useEffect,
  useId,
  useRef,
  type FocusEventHandler,
  type JSX,
  type KeyboardEvent,
  type KeyboardEventHandler,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { mix } from '../theme/mix';
import { focusRing } from '../theme/states';
import { SurfaceContext, tintBase, useSurface, type Surface } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';
import { visuallyHidden } from '../theme/a11y';
import { reducedMotion } from '../overlays/surface';
import { Avatar } from '../display/Avatar';
import { Icon } from '../display/Icon';
import { Button } from '../controls/Button';

export type MessageState = 'sent' | 'pending' | 'failed';

/** How the actions were asked for, so the screen can choose a Sheet (touch) or a Menu, and buzz on touch. */
export type OpenActionsVia = 'touch' | 'pointer' | 'keyboard';

/** What the message list's roving focus needs on a row (the list core owns which row is the Tab stop). */
export interface MessageRowFocus {
  /** This row is the list's one Tab stop (`tabIndex` 0); every other row is -1, still focusable by the list. */
  tabStop: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  onFocus?: FocusEventHandler<HTMLElement>;
}

export interface MessageRowProps {
  /** Who wrote it. Shown on the first row of a group; read on every row. */
  author: string;
  avatarSrc?: string;
  /** The author's own colour, `#rrggbb`, for the avatar. */
  avatarColour?: string;
  /** The short time shown: "8:19 PM", "Yesterday 8:19 PM". */
  time: string;
  /** The machine-readable time (ISO 8601) for `<time dateTime>`. */
  dateTime?: string;
  /** The full date and time, read and shown as the time's tooltip: "Monday 3 March 2026, 8:19 PM". */
  timeLabel?: string;
  /** A follow-on message from the same author: no avatar or name line; the time shows in the gutter on hover and focus. */
  continued?: boolean;
  /** It mentions the reader: an accent rail and tint. */
  mentioned?: boolean;
  /** The jump target (a link to this message, a search result): a stronger accent tint while set. */
  highlighted?: boolean;
  /** `pending`: on its way, dimmed, "Sending…". `failed`: not sent, with Retry and Delete when given. */
  state?: MessageState;
  /** Shows "(edited)" after the time. */
  edited?: boolean;
  /** Shows the pin mark after the time. */
  pinned?: boolean;
  /** The reply quote, above the body. */
  quote?: ReactNode;
  /** The words: a `MessageText`, or an inline editing `Composer`. */
  body?: ReactNode;
  attachments?: ReactNode;
  /** `ReactionChip`s; they wrap onto more lines. */
  reactions?: ReactNode;
  /** Under everything: the thread replies link. */
  footer?: ReactNode;
  /**
   * A toolbar of `IconButton`s at the row's top end, shown on hover and while focus is in the row. For pointer
   * screens (compact and wide); on a phone, use `onOpenActions`.
   */
  actions?: ReactNode;
  /**
   * The row's actions were asked for: a long press on touch, a right-click, or the context-menu key (or
   * Shift+F10) on the focused row. The native menu is suppressed.
   */
  onOpenActions?: (via: OpenActionsVia) => void;
  /** The name (and avatar) opens the author's profile. Without it the name is plain text. */
  onOpenAuthor?: () => void;
  onRetry?: () => void;
  onDelete?: () => void;
  focus?: MessageRowFocus;
  ref?: Ref<HTMLDivElement>;
  id?: string;
}

/** A press held this long without moving is a long press (as the classic chat's). */
export const LONG_PRESS_MS = 500;
/** A finger that moves further than this before the long press fires is scrolling, not pressing. */
const LONG_PRESS_SLOP = tokens.space.sm;

interface RootProps {
  $continued: boolean;
  $mentioned: boolean;
  $highlighted: boolean;
  $on: Surface;
}

const Root = styled('div', { shouldForwardProp: transientProps })<RootProps>(
  ({ theme, $continued, $mentioned, $highlighted, $on }) => {
    const { palette } = kitTheme(theme);
    const under = tintBase(palette, $on);
    const rest = $highlighted
      ? mix(palette.accent, under, tokens.state.hoverOnFill)
      : $mentioned
        ? mix(palette.accent, under, tokens.state.pressed)
        : 'transparent';
    return {
      ...reducedMotion,
      position: 'relative',
      display: 'flex',
      gap: `${tokens.space.md}px`,
      minWidth: 0,
      padding: `${$continued ? tokens.space['2xs'] : tokens.space.sm}px ${tokens.space.md}px ${tokens.space['2xs']}px`,
      borderRadius: `${tokens.radius.md}px`,
      background: rest,
      // The mention rail: an inset edge, so it takes no room and does not rest on the tint alone.
      boxShadow: $mentioned ? `inset ${tokens.border.selected}px 0 0 ${palette.accent}` : 'none',
      transition: `background-color ${tokens.motion.slow}ms`,
      outline: 'none',
      '&:focus-visible': focusRing(palette, -tokens.border.focus),
      '@media (hover: hover)': {
        '&:hover': { background: $highlighted || $mentioned ? rest : mix(palette.text, under, tokens.state.hover) },
      },
      // The quiet parts (a continued row's time, the actions) show on hover and while focus is in the row.
      '&:focus-within [data-reveal]': { opacity: 1 },
      '@media (hover: hover) and (pointer: fine)': { '&:hover [data-reveal]': { opacity: 1 } },
    };
  },
);

const Gutter = styled('div')({
  flex: `0 0 ${tokens.avatar.md}px`,
  width: `${tokens.avatar.md}px`,
  display: 'flex',
  justifyContent: 'flex-end',
});

const AvatarButton = styled('button')(({ theme }) => ({
  display: 'inline-flex',
  margin: 0,
  padding: 0,
  border: 'none',
  background: 'none',
  borderRadius: `${tokens.radius.full}px`,
  cursor: 'pointer',
  height: 'fit-content',
  '&:focus-visible': focusRing(kitTheme(theme).palette),
}));

const GutterTime = styled('span')(({ theme }) => {
  const { palette } = kitTheme(theme);
  const type = tokens.text.small;
  return {
    ...reducedMotion,
    opacity: 0,
    transition: `opacity ${tokens.motion.fast}ms`,
    // On the first line of body text.
    paddingTop: `${(tokens.text.body.line - type.line) / 2}px`,
    whiteSpace: 'nowrap',
    fontFamily: theme.typography.fontFamily,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    color: palette.textSecondary,
  };
});

const Column = styled('div', { shouldForwardProp: transientProps })<{ $pending: boolean }>(({ $pending }) => ({
  flex: '1 1 auto',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: `${tokens.space['2xs']}px`,
  ...($pending && { opacity: tokens.state.disabled }),
}));

const Header = styled('div')({
  display: 'flex',
  alignItems: 'baseline',
  gap: `${tokens.space.sm}px`,
  minWidth: 0,
});

const nameStyle = (theme: Parameters<typeof kitTheme>[0]) => {
  const { palette } = kitTheme(theme);
  const type = tokens.text.name;
  return {
    display: 'block',
    minWidth: 0,
    flex: '0 1 auto',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    margin: 0,
    padding: 0,
    border: 'none',
    background: 'none',
    textAlign: 'start' as const,
    color: palette.text,
    fontFamily: `'${type.family}', ${theme.typography.fontFamily}`,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    fontWeight: type.weight,
  };
};

const Name = styled('span')(({ theme }) => nameStyle(theme));
const NameButton = styled('button')(({ theme }) => ({
  ...nameStyle(theme),
  cursor: 'pointer',
  borderRadius: `${tokens.radius.sm}px`,
  '@media (hover: hover)': { '&:hover': { textDecoration: 'underline' } },
  '&:focus-visible': focusRing(kitTheme(theme).palette, 0),
}));

const Meta = styled('span', { shouldForwardProp: transientProps })<{ $tone: 'secondary' | 'danger' }>(
  ({ theme, $tone }) => {
    const { palette } = kitTheme(theme);
    const type = tokens.text.small;
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: `${tokens.space.xs}px`,
      flexShrink: 0,
      whiteSpace: 'nowrap',
      fontFamily: theme.typography.fontFamily,
      fontSize: `${type.size}px`,
      lineHeight: `${type.line}px`,
      color: $tone === 'danger' ? palette.danger : palette.textSecondary,
    };
  },
);

const Failed = styled('div')({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: `${tokens.space.sm}px`,
});

const Reactions = styled('div')({
  display: 'flex',
  flexWrap: 'wrap',
  gap: `${tokens.space.xs}px`,
  marginTop: `${tokens.space.xs}px`,
});

const Slot = styled('div')({ minWidth: 0 });

const Actions = styled('div')(({ theme }) => {
  const lounge = kitTheme(theme);
  const { palette } = lounge;
  return {
    ...reducedMotion,
    position: 'absolute',
    top: `-${tokens.space.md}px`,
    insetInlineEnd: `${tokens.space.md}px`,
    zIndex: 1,
    display: 'flex',
    gap: `${tokens.space['2xs']}px`,
    padding: `${tokens.space['2xs']}px`,
    borderRadius: `${tokens.radius.full}px`,
    background: palette.surface,
    border: `${tokens.border.hairline}px solid ${palette.hairline}`,
    opacity: 0,
    transition: `opacity ${tokens.motion.fast}ms`,
  };
});

const Hidden = styled('span')({ ...visuallyHidden });

/**
 * One message in a compact list (principles §4): the author's avatar, name and time on one line, the words under
 * it, no bubble. Slots for a quote, attachments, reactions and a thread footer. A `continued` row is a follow-on
 * from the same author. The row is one stop of the list's roving focus; its actions open on long press,
 * right-click or the context-menu key, or show as a toolbar on hover and focus.
 */
export function MessageRow({
  author,
  avatarSrc,
  avatarColour,
  time,
  dateTime,
  timeLabel,
  continued = false,
  mentioned = false,
  highlighted = false,
  state = 'sent',
  edited = false,
  pinned = false,
  quote,
  body,
  attachments,
  reactions,
  footer,
  actions,
  onOpenActions,
  onOpenAuthor,
  onRetry,
  onDelete,
  focus,
  ref,
  id,
}: MessageRowProps): JSX.Element {
  const on = useSurface();
  const uid = useId();
  const authorId = `${uid}-author`;
  const timeId = `${uid}-time`;
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const cancelPress = () => {
    if (press.current !== null) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    firedRef.current = false;
    if (onOpenActions === undefined || event.pointerType !== 'touch') return;
    cancelPress();
    const timer = setTimeout(() => {
      press.current = null;
      firedRef.current = true;
      onOpenActions('touch');
    }, LONG_PRESS_MS);
    press.current = { timer, x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = press.current;
    if (start === null) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP) cancelPress();
  };
  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (onOpenActions === undefined) return;
    event.preventDefault();
    // A touch long press also raises a context menu (Android): the timer already handled it, or does now.
    if (press.current !== null) {
      cancelPress();
      firedRef.current = true;
      onOpenActions('touch');
      return;
    }
    if (firedRef.current) return;
    onOpenActions('pointer');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const asked = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
    // Only the row itself: a key on a control inside it (a reaction, a link) is that control's.
    if (asked && onOpenActions !== undefined && event.target === event.currentTarget) {
      event.preventDefault();
      onOpenActions('keyboard');
      return;
    }
    focus?.onKeyDown?.(event);
  };

  const pending = state === 'pending';
  const failed = state === 'failed';
  const timeElement = (
    <time id={timeId} dateTime={dateTime} title={timeLabel}>
      {time}
      {timeLabel !== undefined && <Hidden>, {timeLabel}</Hidden>}
    </time>
  );
  const marks = (
    <>
      {edited && <Meta $tone="secondary">(edited)</Meta>}
      {pinned && (
        <Meta $tone="secondary">
          <Icon name="Pin" size="xs" />
          <Hidden>Pinned</Hidden>
        </Meta>
      )}
      {pending && <Meta $tone="secondary">Sending…</Meta>}
    </>
  );

  return (
    <Root
      ref={ref}
      id={id}
      role="article"
      aria-labelledby={`${authorId} ${timeId}`}
      aria-busy={pending || undefined}
      tabIndex={focus === undefined ? undefined : focus.tabStop ? 0 : -1}
      onFocus={focus?.onFocus}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={onContextMenu}
      $continued={continued}
      $mentioned={mentioned}
      $highlighted={highlighted}
      $on={on}
    >
      <Gutter>
        {continued ? (
          <GutterTime data-reveal="" aria-hidden="true">
            {time}
          </GutterTime>
        ) : onOpenAuthor !== undefined ? (
          // The name is the keyboard path to the profile; the avatar is a pointer shortcut to the same place.
          <AvatarButton type="button" tabIndex={-1} aria-hidden="true" onClick={onOpenAuthor}>
            <Avatar decorative name={author} src={avatarSrc} colour={avatarColour} size="md" />
          </AvatarButton>
        ) : (
          <Avatar decorative name={author} src={avatarSrc} colour={avatarColour} size="md" />
        )}
      </Gutter>
      <Column $pending={pending}>
        {continued ? (
          <Hidden>
            <span id={authorId}>{author}</span> {timeElement}
          </Hidden>
        ) : (
          <Header>
            {onOpenAuthor !== undefined ? (
              <NameButton id={authorId} type="button" dir="auto" onClick={onOpenAuthor}>
                {author}
              </NameButton>
            ) : (
              <Name id={authorId} dir="auto">
                {author}
              </Name>
            )}
            <Meta $tone="secondary">{timeElement}</Meta>
            {marks}
          </Header>
        )}
        {continued && (edited || pinned || pending) && <Header>{marks}</Header>}
        {quote !== undefined && <Slot>{quote}</Slot>}
        {body !== undefined && <Slot>{body}</Slot>}
        {attachments !== undefined && <Slot>{attachments}</Slot>}
        {failed && (
          <Failed>
            <Meta $tone="danger">
              <Icon name="CircleAlert" size="xs" tone="danger" />
              Not sent
            </Meta>
            {onRetry !== undefined && (
              <Button variant="text" size="sm" onClick={onRetry}>
                Retry
              </Button>
            )}
            {onDelete !== undefined && (
              <Button variant="quietDanger" size="sm" onClick={onDelete}>
                Delete
              </Button>
            )}
          </Failed>
        )}
        {reactions !== undefined && <Reactions>{reactions}</Reactions>}
        {footer !== undefined && <Slot>{footer}</Slot>}
      </Column>
      {actions !== undefined && (
        <Actions data-reveal="" role="toolbar" aria-label={`Actions for ${author}'s message`}>
          <SurfaceContext value="surface">{actions}</SurfaceContext>
        </Actions>
      )}
    </Root>
  );
}
