import { useRef, type ChangeEvent, type ClipboardEvent, type JSX, type KeyboardEvent, type KeyboardEventHandler, type ReactNode, type Ref } from 'react';
import { styled } from '@mui/material/styles';
import InputBase from '@mui/material/InputBase';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { focusRing } from '../theme/states';
import { SurfaceContext, standOutFill, useSurface, type Surface } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';
import { useToastClearance } from '../behaviour/hosts/toasts';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { Icon } from '../display/Icon';
import type { IconName } from '../icons/generated';

/** How tall the field may grow before it scrolls: with the on-screen keyboard up, on a phone, or on a wide screen. */
export type ComposerCap = 'keyboard' | 'phone' | 'desktop';

const CAP_ROWS: Record<ComposerCap, number> = { keyboard: 2, phone: 4, desktop: 10 };

/** What the trailing button does: send a new message, or save an edit to one. */
export type ComposerMode = 'send' | 'save';

const SUBMIT: Record<ComposerMode, { label: string; icon: IconName }> = {
  send: { label: 'Send message', icon: 'Send' },
  save: { label: 'Save changes', icon: 'Check' },
};

/**
 * A keydown that belongs to an input method (Japanese, Chinese, Korean): while it composes, and the Enter that
 * commits its candidate, which Safari sends after `compositionend` with `isComposing` false and the IME's `keyCode`
 * 229, so both are checked.
 */
function inputMethodKey(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

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

/** Files are being dragged over the conversation: the composer shows where they go. */
export interface ComposerDropTarget {
  active: boolean;
  /** "Drop files to attach them" */
  label: string;
}

/** The files among what was pasted (pictures, copied files); none for plain text. */
function pastedFiles(data: DataTransfer | null): File[] {
  const files: File[] = [];
  for (const item of Array.from(data?.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file !== null) files.push(file);
  }
  return files;
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
  /** Send (or save): the trailing button, or Enter when `submitOnEnter`. Not called while it cannot send or is sending. */
  onSubmit: () => void;
  /**
   * `send` (default): "Send message" with the Send icon. `save`: editing a message, "Save changes" with a check;
   * `inline` in save mode has no trailing button but a small line under the field instead, "escape to cancel •
   * enter to save" (with `submitOnEnter`; plain "Cancel • Save" without), whose words are the buttons.
   */
  mode?: ComposerMode;
  /**
   * Leaves the edit unchanged: the hint's "cancel" (inline save mode; without it the hint offers only "save").
   * Escape is the screen's (`onKeyDown`).
   */
  onCancel?: () => void;
  /**
   * Drawn inside a message row (editing in place): no outer padding, and it does not keep toasts clear of itself
   * (a row mid-list, or scrolled out of view, must not move the toasts). Default false: the conversation's composer.
   */
  inline?: boolean;
  /**
   * Whether there is something to send. Default: the text is not blank. Pass true when only attachments are
   * queued. While false, Send stays focusable but reads as unavailable.
   */
  canSend?: boolean;
  /** Send was pressed while there is nothing to send: say why (`useAnnounce`), as IconButton's `onUnavailablePress`. */
  onSendUnavailablePress?: () => void;
  /** A message is on its way: Send is busy (spinner, presses ignored); the field stays editable. */
  sending?: boolean;
  /** Enter sends and Shift+Enter starts a new line. Off on touch, where Enter is a new line. Default true. */
  submitOnEnter?: boolean;
  /**
   * The screen's own keys (mentions list, Escape, ↑ to edit), called first. If it calls `preventDefault`, the
   * composer does nothing more with that key. Never called while an input method is composing.
   */
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  /** The caret or the selection in the field moved (typing, keys, a tap): a suggestion list follows the caret. */
  onCaretMove?: () => void;
  /** How far the field grows before it scrolls. Default `desktop`. */
  cap?: ComposerCap;
  /** Shows the leading attach button. */
  onAttach?: () => void;
  /**
   * The reader may not attach files here: the attach button stays named and focusable, reads as unavailable
   * (`aria-disabled`) and does not call `onAttach`.
   */
  attachUnavailable?: boolean;
  /** The unavailable attach button was pressed: say why ("You can't attach files in #announcements"). */
  onAttachUnavailablePress?: () => void;
  /** The trailing slot inside the field, before Send: the emoji and GIF buttons. */
  emoji?: ReactNode;
  /**
   * Files were pasted into the field (a picture, copied files): the composer reads them from the clipboard. Text
   * pastes as usual.
   */
  onPasteFiles?: (files: File[]) => void;
  /** Files are dragged over the conversation (the screen's drop zone): the composer is drawn as the drop target. */
  dropTarget?: ComposerDropTarget;
  /** Replying or editing: a strip above the field with a cancel button. */
  banner?: ComposerBanner;
  /** The reader cannot write: the notice takes the place of the field and its buttons. */
  notice?: ComposerNotice;
  /** Files queued with the message: a tray above the field. */
  attachments?: ReactNode;
  popup?: ComposerPopup;
  /**
   * The open suggestion list (a `SuggestionList`, its id `popup.listId`): drawn over the conversation, just above
   * the composer, across its width. Give it with `popup`.
   */
  suggestions?: ReactNode;
  /** The text field. */
  ref?: Ref<HTMLTextAreaElement>;
}

const Root = styled('div', { shouldForwardProp: transientProps })<{ $inline: boolean }>(({ $inline }) => ({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: `${tokens.space.sm}px`,
  minWidth: 0,
  padding: $inline ? 0 : `${tokens.space.sm}px ${tokens.space.md}px ${tokens.space.md}px`,
}));

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

/** Above the composer, over the bottom of the conversation, inset like the field. */
const Above = styled('div', { shouldForwardProp: transientProps })<{ $inline: boolean }>(({ $inline }) => ({
  position: 'absolute',
  bottom: '100%',
  insetInline: $inline ? 0 : `${tokens.space.md}px`,
  zIndex: 1,
}));

/** Over the composer while files are dragged over the conversation: where they go. */
const Drop = styled('div')(({ theme }) => {
  const { palette } = kitTheme(theme);
  const type = tokens.text.bodyStrong;
  return {
    position: 'absolute',
    inset: 0,
    zIndex: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: `${tokens.space.sm}px`,
    borderRadius: `${tokens.radius.island}px`,
    border: `${tokens.border.selected}px dashed ${palette.accent}`,
    background: palette.surface,
    color: palette.text,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    fontWeight: type.weight,
    pointerEvents: 'none',
  };
});

/** Under an inline editor: "escape to cancel • enter to save". */
const Hint = styled('div')(({ theme }) => {
  const { palette } = kitTheme(theme);
  const type = tokens.text.small;
  return {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: `${tokens.space.xs}px`,
    minWidth: 0,
    color: palette.textSecondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    fontWeight: type.weight,
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
 * screen's. It keeps toasts clear of itself, unless it is `inline` (editing inside a message row).
 */
export function Composer({
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  mode = 'send',
  onCancel,
  inline = false,
  canSend,
  onSendUnavailablePress,
  sending = false,
  submitOnEnter = true,
  onKeyDown,
  onCaretMove,
  cap = 'desktop',
  onAttach,
  attachUnavailable = false,
  onAttachUnavailablePress,
  emoji,
  onPasteFiles,
  dropTarget,
  banner,
  notice,
  attachments,
  popup,
  suggestions,
  ref,
}: ComposerProps): JSX.Element {
  const on = useSurface();
  const rootRef = useRef<HTMLDivElement>(null);
  // An inline editor registers a ref it never attaches: the toast host skips an empty clearance.
  const noClearance = useRef<HTMLDivElement>(null);
  useToastClearance(inline ? noClearance : rootRef);
  const sendable = canSend ?? value.trim() !== '';
  const submit = () => {
    if (sendable && !sending) onSubmit();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // While an input method composes, every key is its own (Enter picks a candidate, Escape closes its list, the
    // arrows move in it): neither the screen's keys nor the composer's run.
    if (inputMethodKey(event)) return;
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (submitOnEnter && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };
  const inside = on === 'fill' ? 'surface' : 'fill';
  // An edit in place has no Save button: the hint under the field saves and cancels.
  const hinted = inline && mode === 'save';

  return (
    <Root ref={rootRef} $inline={inline}>
      {suggestions !== undefined && notice === undefined && <Above $inline={inline}>{suggestions}</Above>}
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
                  onUnavailablePress={onAttachUnavailablePress}
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
                  onSelect: onCaretMove,
                  onPaste:
                    onPasteFiles === undefined
                      ? undefined
                      : (event: ClipboardEvent<HTMLTextAreaElement>) => {
                          const files = pastedFiles(event.clipboardData);
                          if (files.length > 0) onPasteFiles(files);
                        },
                }}
              />
              {emoji}
            </SurfaceContext>
          </FieldBox>
          {!hinted && (
            <IconButton
              icon={SUBMIT[mode].icon}
              variant="primary"
              size="lg"
              label={SUBMIT[mode].label}
              aria-disabled={!sendable}
              onUnavailablePress={onSendUnavailablePress}
              loading={sending}
              onClick={submit}
            />
          )}
        </Row>
      )}
      {hinted && notice === undefined && (
        <Hint>
          {onCancel !== undefined && (
            <>
              {submitOnEnter && <span>escape to</span>}
              <Button variant="text" size="sm" aria-label="Cancel editing" onClick={onCancel}>
                {submitOnEnter ? 'cancel' : 'Cancel'}
              </Button>
              <span aria-hidden>•</span>
            </>
          )}
          {submitOnEnter && <span>enter to</span>}
          <Button
            variant="text"
            size="sm"
            loading={sending}
            aria-disabled={!sendable || undefined}
            aria-label={SUBMIT.save.label}
            onClick={submit}
          >
            {submitOnEnter ? 'save' : 'Save'}
          </Button>
        </Hint>
      )}
      {dropTarget?.active === true && notice === undefined && (
        <Drop>
          <Icon name="Paperclip" size="md" tone="secondary" />
          <span>{dropTarget.label}</span>
        </Drop>
      )}
    </Root>
  );
}
