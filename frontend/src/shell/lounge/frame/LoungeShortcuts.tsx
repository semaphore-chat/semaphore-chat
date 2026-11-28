/**
 * The Lounge's desktop keyboard shortcuts (design §3 PR 10e), at compact and wide (a phone has none), on the pure
 * table and matchers of `utils/shortcuts.ts` that the old desktop layout's `useGlobalShortcuts` reads too:
 *
 * - Alt+↑/↓: the previous or next text channel of the community; Alt+Shift+↑/↓: the previous or next unread one
 *   ("No unread channels" when there is none). Where it went is announced. Not from a field other than the channel's
 *   composer, not while a layer is open.
 * - Mod+/: the shortcut sheet (a kit Dialog); again closes it. It opens from a field too, never over another layer.
 * - Push-to-talk owns its key (`KeyboardEvent.code`, while connected to voice in push-to-talk mode), whatever
 *   modifiers are held: it is never a shortcut and never marks the channel read (the old layout's guard).
 * - Escape: the last step of the screen's Escape chain (`ESCAPE_PRIORITY.conversation`): marks the open channel read
 *   ("Marked as read"). Anything that used the key first (a layer, the right panel, an edit, the mention list) keeps it.
 *
 * One `window` keydown listener in the bubble phase, so every more specific handler runs first and anything it
 * handled (`defaultPrevented`) is left alone.
 */
import { useCallback, useContext, useEffect, useRef, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, ESCAPE_PRIORITY, KeyCap, Stack, Text, useAnnounce, useScreenEscape, useWidthRange } from '../../../kit';
import { VoiceStateContext } from '../../../contexts/VoiceContext';
import { useVoiceSettings } from '../../../hooks/useVoiceSettings';
import { useTouchFirst } from '../../../data/touchFirst';
import { useCommunityChannels } from '../../../data/channels';
import { useUnreadSummary } from '../../../data/unread';
import {
  findNavTarget,
  focusComposer,
  isComposerTarget,
  isEditableTarget,
  isModalOpen,
  matchGlobalShortcut,
  shortcutKeyLabels,
  shortcutSpokenLabel,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  type NavItem,
} from '../../../utils/shortcuts';
import { markConversationRead } from '../../../utils/markConversationRead';
import { isMacPlatform } from '../../../utils/platform';
import { logger } from '../../../utils/logger';
import { useLoungeLinks } from '../links';

/** The community's text channels in the left island's order, the open one, and how to go to one. */
interface NavSource {
  items: NavItem[];
  currentId: string | undefined;
  select(id: string): void;
}

/** Whether a layer is open: a kit Dialog or Sheet (`aria-modal`), or a MUI modal (a kit Menu). */
function layerOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null || isModalOpen();
}

/** Keeps `source` up to date with the community's text channels (as the left island lists them) and their unread. */
function CommunityNav({
  communityId,
  channelId,
  source,
}: {
  communityId: string;
  channelId: string | null;
  source: { current: NavSource | null };
}): null {
  const navigate = useNavigate();
  const links = useLoungeLinks();
  const { text } = useCommunityChannels(communityId);
  const unread = useUnreadSummary();
  useEffect(() => {
    source.current = {
      items: text.map((channel) => ({ id: channel.id, label: `#${channel.name}`, unread: unread.channel(channel.id).unread > 0 })),
      currentId: channelId ?? undefined,
      select: (id) => navigate(links.channel(communityId, id).replace(/^#/, '')),
    };
    return () => {
      source.current = null;
    };
  }, [text, unread, channelId, communityId, links, navigate, source]);
  return null;
}

export interface LoungeShortcutsProps {
  /** The community whose channels Alt+↑/↓ walks; null (the inbox): no channel shortcuts. */
  communityId: string | null;
  /** The open channel, which Escape marks read. */
  channelId: string | null;
}

export function LoungeShortcuts({ communityId, channelId }: LoungeShortcutsProps): JSX.Element {
  const queryClient = useQueryClient();
  const announce = useAnnounce();
  const source = useRef<NavSource | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetOpenRef = useRef(sheetOpen);
  sheetOpenRef.current = sheetOpen;
  const announceRef = useRef(announce);
  announceRef.current = announce;
  // The push-to-talk key's code while it applies, and the code of the key being pressed (for the Escape step, which
  // is not handed the event).
  const voiceConnected = useContext(VoiceStateContext)?.isConnected ?? false;
  const { isPushToTalk, pushToTalkKey } = useVoiceSettings();
  const pttKeyRef = useRef<string | null>(null);
  pttKeyRef.current = voiceConnected && isPushToTalk ? pushToTalkKey : null;
  const pressedCode = useRef<string | null>(null);
  useEffect(() => {
    const note = (event: KeyboardEvent) => {
      pressedCode.current = event.code;
    };
    window.addEventListener('keydown', note, true);
    return () => window.removeEventListener('keydown', note, true);
  }, []);

  // The last step of the Escape chain: mark the open channel read.
  useScreenEscape(() => {
    if (channelId === null) return false;
    if (pttKeyRef.current !== null && pressedCode.current === pttKeyRef.current) return false;
    markConversationRead(queryClient, 'channel', channelId)
      .then((marked) => {
        if (marked) announceRef.current('Marked as read');
      })
      .catch((error: unknown) => logger.error('[LoungeShortcuts] Failed to mark as read:', error));
    return true;
  }, ESCAPE_PRIORITY.conversation);

  useEffect(() => {
    const mac = isMacPlatform();
    const go = (direction: 1 | -1, unreadOnly: boolean, fromComposer: boolean): boolean => {
      const nav = source.current;
      if (nav === null) return false;
      const target = findNavTarget(nav.items, nav.currentId, direction, unreadOnly);
      if (target === null) {
        if (unreadOnly) announceRef.current('No unread channels');
        return true;
      }
      nav.select(target.id);
      announceRef.current(target.unread ? `${target.label}, unread` : target.label);
      if (fromComposer) {
        // Keep typing where you were: if the switch dropped focus, back into the (new) channel's composer.
        requestAnimationFrame(() => {
          if (document.activeElement && document.activeElement !== document.body) return;
          focusComposer();
        });
      }
      return true;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      const id = matchGlobalShortcut(event, mac);
      // Escape is the screen's Escape chain's (above).
      if (id === null || id === 'escape') return;
      if (id === 'shortcutSheet') {
        // Toggles even from a text field; another layer on top keeps it.
        if (!sheetOpenRef.current && layerOpen()) return;
        event.preventDefault();
        setSheetOpen((open) => !open);
        return;
      }
      // Push-to-talk owns its key, whatever modifiers are held.
      if (pttKeyRef.current !== null && event.code === pttKeyRef.current) return;
      if (layerOpen()) return;
      const fromComposer = isComposerTarget(event.target);
      if (isEditableTarget(event.target) && !fromComposer) return;
      const handled =
        id === 'prevChannel'
          ? go(-1, false, fromComposer)
          : id === 'nextChannel'
            ? go(1, false, fromComposer)
            : id === 'prevUnread'
              ? go(-1, true, fromComposer)
              : id === 'nextUnread'
                ? go(1, true, fromComposer)
                : false;
      if (handled) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const closeSheet = useCallback(() => setSheetOpen(false), []);
  return (
    <>
      {communityId !== null && <CommunityNav communityId={communityId} channelId={channelId} source={source} />}
      <ShortcutSheet open={sheetOpen} onClose={closeSheet} />
    </>
  );
}

export interface ShortcutSheetProps {
  open: boolean;
  onClose: () => void;
  /** The key names to show (tests and stories); the platform's by default. */
  mac?: boolean;
  /** Touch-first (tests and stories): "Edit your last message" is off there, so it is not listed. */
  touch?: boolean;
}

/** The shortcut sheet: every shortcut by group, its keys as key caps (read as "Alt plus Down arrow"). */
export function ShortcutSheet({ open, onClose, mac = isMacPlatform(), touch }: ShortcutSheetProps): JSX.Element {
  const touchFirst = useTouchFirst(useWidthRange());
  const hideEditLast = touch ?? touchFirst;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      size="md"
      actions={
        <Button onClick={onClose}>
          Close
        </Button>
      }
    >
      <Stack gap="lg">
        {SHORTCUT_GROUPS.map((group) => (
          <Stack key={group} gap="sm">
            <Text variant="section" tone="secondary" as="h3">
              {group}
            </Text>
            {SHORTCUTS.filter((shortcut) => shortcut.group === group && !(hideEditLast && shortcut.id === 'editLast')).map((shortcut) => (
              <Stack key={shortcut.id} direction="row" gap="md">
                <Stack gap="xs" fill>
                  <Text>{shortcut.description}</Text>
                </Stack>
                <span aria-label={shortcutSpokenLabel(shortcut.id, mac)} role="img">
                  <Stack direction="row" gap="xs">
                    {shortcutKeyLabels(shortcut.id, mac).map((key) => (
                      <KeyCap key={key}>{key}</KeyCap>
                    ))}
                  </Stack>
                </span>
              </Stack>
            ))}
          </Stack>
        ))}
      </Stack>
    </Dialog>
  );
}
