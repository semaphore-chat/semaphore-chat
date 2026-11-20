/**
 * The emoji picker (PR 10d-C): a kit Sheet with a search field on top and the kit PickerGrid of the shared picker
 * model (`data/chat/useEmojiPicker`: recently used, the community's custom emoji, the built-in set). The composer's
 * emoji button opens it to insert at the caret; "More reactions" in a message's actions opens it to react.
 *
 * Focus: with a keyboard it goes to the search field as the sheet opens; on touch it stays on the sheet's Close (the
 * kit Sheet's default), so the on-screen keyboard does not jump up over the grid. Escape, the scrim and Close shut it;
 * focus then returns to `opener` (the emoji button, or the message's row).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { PickerGrid, Sheet, Stack, Text, TextField, type PickerGridItem } from '../../../../kit';
import { useEmojiPicker, type EmojiPick } from '../../../../data/chat/useEmojiPicker';

export interface EmojiPickerSheetProps {
  /** "Add emoji" (the composer) or "Add reaction". */
  title: string;
  communityId: string;
  /** Touch first: focus stays off the search field. */
  touch: boolean;
  /** Where focus returns when it closes. */
  opener?: HTMLElement | null;
  /** An emoji was picked; the sheet closes itself (`onDone` follows). */
  onPick: (pick: EmojiPick) => void;
  /** Closed, with or without a pick. */
  onDone: () => void;
}

export function EmojiPickerSheet({ title, communityId, touch, opener, onPick, onDone }: EmojiPickerSheetProps): JSX.Element {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  const picker = useEmojiPicker({ communityId, query });
  const search = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const picked = useRef<EmojiPick | null>(null);

  // With a keyboard, straight into the search (after the sheet has put focus on Close).
  useEffect(() => {
    if (touch) return;
    const frame = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [touch]);

  // Done once the sheet has closed and given focus back: a pick runs then (the composer refocuses its field).
  useEffect(() => {
    if (open) return;
    const pick = picked.current;
    if (pick !== null) onPick(pick);
    onDone();
  }, [open, onPick, onDone]);

  const byId = useMemo(() => {
    const map = new Map<string, EmojiPick>();
    for (const section of picker.sections) for (const item of section.items) map.set(item.id, item.pick);
    return map;
  }, [picker.sections]);

  const pick = useCallback(
    (item: PickerGridItem) => {
      const chosen = byId.get(item.id);
      if (chosen === undefined) return;
      picker.noteUsed(chosen);
      picked.current = chosen;
      setOpen(false);
    },
    [byId, picker],
  );

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title={title}
      size="lg"
      opener={opener}
      top={
        <TextField
          ref={search}
          label="Search emoji"
          labelHidden
          type="search"
          shape="round"
          startIcon="Search"
          placeholder="Search emoji"
          value={query}
          onChange={setQuery}
        />
      }
    >
      {picker.hasResults ? (
        <PickerGrid label="Emoji" sections={picker.sections} onPick={pick} />
      ) : (
        <Stack gap="xs" align="start">
          <Text variant="bodyStrong" as="p">
            No emoji found
          </Text>
          <Text variant="meta" tone="secondary" as="p">
            Try a different word.
          </Text>
        </Stack>
      )}
    </Sheet>
  );
}
