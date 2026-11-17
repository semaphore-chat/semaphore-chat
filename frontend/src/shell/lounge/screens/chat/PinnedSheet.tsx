/**
 * A channel's pinned messages in the new shell's chat (PR 10d-B): a kit Sheet from the header's More menu, on the
 * shared pinned-list model (`data/chat/usePinnedList`, the old panel's list, Unpin and who may unpin). A pin's row
 * shows who wrote it and its words (or its files); pressing it closes the sheet and jumps to the message (a thread
 * reply: to its parent, then its thread opens). Unpin, for those who may, only in a known text channel; the list
 * stays current through the socket's pin events and Unpin's refresh. Focus returns to More when the sheet closes; a
 * row that goes away (unpinned) hands focus to its neighbour.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Avatar, Button, IconButton, ListRow, Sheet, Skeleton, Stack, Text, personColour, useToasts } from '../../../../kit';
import { userControllerGetUserByIdOptions } from '../../../../api-client/@tanstack/react-query.gen';
import type { PinnedMessageDto } from '../../../../api-client/types.gen';
import { pinnedText, usePinnedList } from '../../../../data/chat/usePinnedList';
import { formatMessageTime } from '../../../../utils/messageTime';

export interface PinnedSheetProps {
  communityId: string;
  channelId: string;
  /** Unpin is a write: only in a known text channel. */
  writable: boolean;
  /** The More button: where focus returns. */
  opener: HTMLElement | null;
  /** The sheet has closed (mounted while open, as the actions sheet). */
  onDone: () => void;
  /** A pin was chosen; called once the sheet has closed. */
  onJump: (pin: PinnedMessageDto) => void;
}

function filesLine(count: number): string {
  return count === 1 ? '1 file' : `${count} files`;
}

function PinRow({
  pin,
  canUnpin,
  onJump,
  onUnpin,
  rowRef,
}: {
  pin: PinnedMessageDto;
  canUnpin: boolean;
  onJump: () => void;
  onUnpin: () => void;
  rowRef: (element: HTMLElement | null) => void;
}): JSX.Element {
  // The pin carries its author (as the old panel reads it); a webhook has its own name.
  const authorId = pin.author?.id ?? pin.authorId;
  const { data: user } = useQuery({
    ...userControllerGetUserByIdOptions({ path: { id: authorId ?? '' } }),
    enabled: !!authorId && !pin.author && !pin.webhook,
  });
  const name = pin.webhook?.name ?? (pin.author?.displayName || pin.author?.username || user?.displayName || user?.username || 'Unknown');
  const words = pinnedText(pin);
  const files = pin.attachments.length;
  const secondary = [words, files > 0 ? filesLine(files) : ''].filter(Boolean).join(' · ') || 'No text';
  return (
    <ListRow
      ref={rowRef}
      size="lg"
      primary={`${name} · ${formatMessageTime(pin.sentAt)}`}
      secondary={secondary}
      leading={<Avatar name={name} colour={authorId && !pin.webhook ? personColour(authorId) : undefined} size="md" decorative />}
      label={`Show the message from ${name}: ${secondary}`}
      onClick={onJump}
      trailing={canUnpin ? <IconButton icon="X" label={`Unpin the message from ${name}`} variant="ghost" onClick={onUnpin} /> : undefined}
    />
  );
}

export function PinnedSheet({ communityId, channelId, writable, opener, onDone, onJump }: PinnedSheetProps): JSX.Element {
  const { pins, isLoading, error, refetch, canUnpin, unpin } = usePinnedList(channelId, communityId);
  const [open, setOpen] = useState(true);
  const [chosen, setChosen] = useState<PinnedMessageDto | null>(null);
  useEffect(() => {
    if (open) return;
    onDone();
    if (chosen !== null) onJump(chosen);
  }, [open, chosen, onDone, onJump]);
  const toasts = useToasts();
  const rows = useRef(new Map<string, HTMLElement>());
  // The row that had focus when it was unpinned: its neighbour takes focus once the list no longer has it.
  const unpinned = useRef<{ id: string; index: number } | null>(null);
  useEffect(() => {
    const gone = unpinned.current;
    if (gone === null || pins === undefined || pins.some((pin) => pin.id === gone.id)) return;
    unpinned.current = null;
    const next = pins[Math.min(gone.index, pins.length - 1)];
    const row = next ? rows.current.get(next.id) : undefined;
    row?.focus({ preventScroll: false });
  }, [pins]);

  const list = pins ?? [];
  const body =
    isLoading ? (
      <Stack gap="md">
        <span role="status">
          <Text variant="small" tone="secondary">
            Loading pinned messages
          </Text>
        </span>
        {Array.from({ length: 3 }, (_, i) => (
          <Stack key={i} direction="row" gap="md">
            <Skeleton shape="circle" size="md" />
            <Stack gap="xs" fill>
              <Skeleton shape="text" lines={2} />
            </Stack>
          </Stack>
        ))}
      </Stack>
    ) : error ? (
      <Stack gap="sm" align="start">
        <Text>Couldn&apos;t load pinned messages</Text>
        <Button onClick={() => void refetch()}>Try again</Button>
      </Stack>
    ) : list.length === 0 ? (
      <Stack gap="xs">
        <Text>No pinned messages yet.</Text>
        <Text variant="small" tone="secondary">
          Pin important messages to keep them easy to find.
        </Text>
      </Stack>
    ) : (
      <Stack gap="xs">
        {list.map((pin, index) => (
          <PinRow
            key={pin.id}
            pin={pin}
            canUnpin={canUnpin && writable}
            rowRef={(element) => {
              if (element) rows.current.set(pin.id, element);
              else rows.current.delete(pin.id);
            }}
            onJump={() => {
              setChosen(pin);
              setOpen(false);
            }}
            onUnpin={() => {
              unpinned.current = { id: pin.id, index };
              void unpin(pin.id).then((ok) => {
                if (!ok) {
                  unpinned.current = null;
                  toasts.show({ tone: 'danger', message: "Couldn't unpin the message" });
                }
              });
            }}
          />
        ))}
      </Stack>
    );

  return (
    <Sheet open={open} onClose={() => setOpen(false)} title={list.length > 0 ? `Pinned messages (${list.length})` : 'Pinned messages'} size="lg" opener={opener}>
      {body}
    </Sheet>
  );
}
