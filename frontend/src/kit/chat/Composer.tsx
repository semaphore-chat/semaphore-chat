import { useRef, type ChangeEvent, type JSX, type KeyboardEvent, type KeyboardEventHandler, type ReactNode, type Ref } from 'react';
import { styled } from '@mui/material/styles';
import InputBase from '@mui/material/InputBase';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { focusRing } from '../theme/states';
import { SurfaceContext, standOutFill, useSurface, type Surface } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';
import { useToastClearance } from '../behaviour/hosts/toasts';
import { IconButton } from '../controls/IconButton';
import { Icon } from '../display/Icon';
import type { IconName } from '../icons/generated';

/** How tall the field may grow before it scrolls: with the on-screen keyboard up, on a phone, or on a wide screen. */
export type ComposerCap = 'keyboard' | 'phone' | 'desktop';

const CAP_ROWS: Record<ComposerCap, number> = { keyboard: 2, phone: 4, desktop: 10 };

/** What the composer is doing to a message other than writing a new one. */
export interface ComposerBanner {
  kind: 'reply' | 'editing';
  /** "Replying to aiko", "Editing message". */
  title: string;
  /** A line of the message replied to or edited. */
  detail?: string;
  /** The cancel button's name: "Cancel reply", "Cancel editing". */
  cancelLabel: string;
  onCancel: () => void;
}

/** Why the reader cannot write here; replaces the field and its buttons. */
export interface ComposerNotice {
  /** "You can't send messages in #announcements", "You're timed out for 4 more minutes". */
  text: string;
  icon?: IconName;
}

/** The field is a combobox's input while a suggestion list (mentions) is open. */
export interface ComposerPopup {
  /** The id of the open list. */
  listId: string;
  /** The id of the highlighted option. */
  activeId?: string;
}

export interface ComposerProps {
  /** The field's name, and its placeholder unless `placeholder` is given: "Message #general". */
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  /** Send: the Send button, or Enter when `submitOnEnter`. Not called while it cannot send or is sending. */
  onSubmit: () => void;
  /**
   * Whether there is something to send. Default: the text is not blank. Pass true when only attachments are
   * queued. While false, Send stays focusable but reads as unavailable.
   */
  canSend?: boolean;
  /** A message is on its way: Send is busy (spinner, presses ignored); the field stays editable. */
  sending?: boolean;
  /** Enter sends and Shift+Enter starts a new line. Off on touch, where Enter is a new line. Default true. */
  submitOnEnter?: boolean;
  /**
   * The screen's own keys (mentions list, Escape, ↑ to edit), called first. If it calls `preventDefault`, the
   * composer does nothing more with that key.
   */
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  /** How far the field grows before it scrolls. Default `desktop`. */
  cap?: ComposerCap;
  /** Shows the leading attach button. */
  onAttach?: () => void;
  /** The reader may not attach files here: the attach button stays named and focusable, and does nothing. */
  attachUnavailable?: boolean;
  /** The trailing slot inside the field, before Send: the emoji button. */
  emoji?: ReactNode;
  /** Replying or editing: a strip above the field with a cancel button. */
  banner?: ComposerBanner;
  /** The reader cannot write: the notice takes the place of the field and its buttons. */
  notice?: ComposerNotice;
  /** Files queued with the message: a tray above the field. */
  attachments?: ReactNode;
  popup?: ComposerPopup;
  /** The text field. */
  ref?: Ref<HTMLTextAreaElement>;
}

const Root = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  gap: `${tokens.space.sm}px`,
  minWidth: 0,
  padding: `${tokens.space.sm}px ${tokens.space.md}px ${tokens.space.md}px`,
});

const Row = styled('div')({
  display: 'flex',
  alignItems: 'flex-end',
  gap: `${tokens.space.sm}px`,
  minWidth: 0,
});

/** The pill the field and its in-field buttons sit in. At one line it is a full pill (`island` is half its height). */
const FieldBox = styled('div', { shouldForwardProp: transientProps })<{ $on: Surface }>(({ theme, $on }) => {
  const { palette } = kitTheme(theme);
  return {
    flex: '1 1 auto',
    minWidth: 0,
    display: 'flex',
    alignItems: 'flex-end',
    gap: `${tokens.space.xs}px`,
    boxSizing: 'border-box',
    minHeight: `${tokens.control.lg}px`,
    padding: `${tokens.space.xs}px`,
    borderRadius: `${tokens.radius.island}px`,
    background: standOutFill(palette, $on),
    '&:has(textarea:focus-visible)': focusRing(palette),
  };
});

const Input = styled(InputBase)(({ theme }) => {
  const { palette } = kitTheme(theme);
  const text = tokens.text.body;
  return {
    flex: '1 1 auto',
    minWidth: 0,
    // Centres one line on the in-field buttons: (button height - line height) / 2 above and below.
    padding: `${(tokens.control.md - text.line) / 2}px ${tokens.space.sm}px`,
    color: palette.text,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${text.size}px`,
    lineHeight: `${text.line}px`,
    fontWeight: text.weight,
    '& textarea': {
      padding: 0,
      resize: 'none',
      color: 'inherit',
      overflowWrap: 'anywhere',
      '&::placeholder': { color: palette.textDim, opacity: 1 },
    },
  };
});

const Strip = styled('div', { shouldForwardProp: transientProps })<{ $on: Surface }>(({ theme, $on }) => {
  const { palette } = kitTheme(theme);
  return {
    display: 'flex',
    alignItems: 'center',
    gap: `${tokens.space.sm}px`,
    minWidth: 0,
    boxSizing: 'border-box',
    minHeight: `${tokens.control.lg}px`,
    padding: `${tokens.space.xs}px ${tokens.space.xs}px ${tokens.space.xs}px ${tokens.space.md}px`,
    borderRadius: `${tokens.radius.card}px`,
    background: standOutFill(palette, $on),
    color: palette.textSecondary,
  };
});

const StripText = styled('div')({ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' });

const Line = styled('span', { shouldForwardProp: transientProps })<{ $strong: boolean }>(({ theme, $strong }) => {
  const { palette } = kitTheme(theme);
  const type = tokens.text.meta;
  return {
    display: 'block',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: theme.typography.fontFamily,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    fontWeight: $strong ? tokens.text.bodyStrong.weight : type.weight,
    color: $strong ? palette.text : palette.textSecondary,
  };
});

const NoticeBox = styled('div', { shouldForwardProp: transientProps })<{ $on: Surface }>(({ theme, $on }) => {
  const { palette } = kitTheme(theme);
  const type = tokens.text.body;
  return {
    display: 'flex',
    alignItems: 'center',
    gap: `${tokens.space.sm}px`,
    boxSizing: 'border-box',
    minHeight: `${tokens.control.lg}px`,
    padding: `${tokens.space.sm}px ${tokens.space.lg}px`,
    borderRadius: `${tokens.radius.island}px`,
    background: standOutFill(palette, $on),
    color: palette.textSecondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    overflowWrap: 'anywhere',
    '& > svg': { flexShrink: 0 },
  };
});

const Tray = styled('div')({
  display: 'flex',
  flexWrap: 'wrap',
  gap: `${tokens.space.sm}px`,
  minWidth: 0,
});

/**
 * The chrome of a message composer: a field that grows to a cap, a leading attach button, a trailing emoji slot
 * and Send, with an optional reply or editing strip and a tray of queued files above it. A `notice` replaces the
 * field when the reader cannot write. Holds no message logic: drafts, mentions, typing and sending are the
 * screen's. It keeps toasts clear of itself.
 */
export function Composer({
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  canSend,
  sending = false,
  submitOnEnter = true,
  onKeyDown,
  cap = 'desktop',
  onAttach,
  attachUnavailable = false,
  emoji,
  banner,
  notice,
  attachments,
  popup,
  ref,
}: ComposerProps): JSX.Element {
  const on = useSurface();
  const rootRef = useRef<HTMLDivElement>(null);
  useToastClearance(rootRef);
  const sendable = canSend ?? value.trim() !== '';
  const submit = () => {
    if (sendable && !sending) onSubmit();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (submitOnEnter && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };
  const inside = on === 'fill' ? 'surface' : 'fill';

  return (
    <Root ref={rootRef}>
      {banner !== undefined && notice === undefined && (
        <Strip $on={on}>
          <Icon name={banner.kind === 'reply' ? 'Reply' : 'Pencil'} size="sm" tone="secondary" />
          <StripText>
            <Line $strong>{banner.title}</Line>
            {banner.detail !== undefined && <Line $strong={false}>{banner.detail}</Line>}
          </StripText>
          <SurfaceContext value={inside}>
            <IconButton icon="X" size="sm" label={banner.cancelLabel} onClick={banner.onCancel} />
          </SurfaceContext>
        </Strip>
      )}
      {attachments !== undefined && notice === undefined && <Tray>{attachments}</Tray>}
      {notice !== undefined ? (
        <NoticeBox $on={on}>
          <Icon name={notice.icon ?? 'Info'} size="md" tone="secondary" />
          <span>{notice.text}</span>
        </NoticeBox>
      ) : (
        <Row>
          <FieldBox $on={on}>
            <SurfaceContext value={inside}>
              {onAttach !== undefined && (
                <IconButton
                  icon="Paperclip"
                  variant="soft"
                  label="Attach a file"
                  aria-disabled={attachUnavailable}
                  onClick={onAttach}
                />
              )}
              <Input
                multiline
                minRows={1}
                maxRows={CAP_ROWS[cap]}
                value={value}
                onChange={(event: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => onChange(event.target.value)}
                placeholder={placeholder ?? label}
                inputRef={ref}
                inputProps={{
                  'aria-label': label,
                  dir: 'auto',
                  'aria-autocomplete': popup === undefined ? undefined : 'list',
                  'aria-controls': popup?.listId,
                  'aria-activedescendant': popup?.activeId,
                  onKeyDown: handleKeyDown,
                }}
              />
              {emoji}
            </SurfaceContext>
          </FieldBox>
          <IconButton
            icon="Send"
            variant="primary"
            size="lg"
            label="Send message"
            aria-disabled={!sendable}
            loading={sending}
            onClick={submit}
          />
        </Row>
      )}
    </Root>
  );
}
