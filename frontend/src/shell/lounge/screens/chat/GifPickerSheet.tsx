/**
 * The GIF picker (PR 10d-C): a kit Sheet with a search field and the kit PickerGrid in its media variant, on the
 * shared GIF search (`data/chat/useGifSearch`: the provider's featured GIFs while the field is empty, results as
 * the reader types, more as they scroll). A pick sends the GIF at once as its own message (the old composer's
 * `handleGifSelect`, medium rendition when there is one). The search goes through the server's `gifs` module, which
 * holds the provider key; the previews load from the provider's CDN without a referrer.
 *
 * Focus as the emoji picker: the search field with a keyboard, Close on touch; it returns to the GIF button.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { Button, PickerGrid, Sheet, Skeleton, Spinner, Stack, Text, TextField, type PickerGridItem } from '../../../../kit';
import type { GifResultDto } from '../../../../api-client/types.gen';
import { useGifSearch } from '../../../../data/chat/useGifSearch';

export interface GifPickerSheetProps {
  touch: boolean;
  opener?: HTMLElement | null;
  /** A GIF was picked: send it. Runs once the sheet has closed. */
  onPick: (gif: GifResultDto) => void;
  onDone: () => void;
}

/** What a picked GIF sends: the medium rendition when the provider has one (the original is often megabytes). */
export function gifSendUrl(gif: GifResultDto): string {
  return gif.mediumUrl || gif.url;
}

function Notice({ title, line, action }: { title: string; line?: string; action?: JSX.Element }): JSX.Element {
  return (
    <Stack gap="xs" align="start">
      <Text variant="bodyStrong" as="p">
        {title}
      </Text>
      {line !== undefined && (
        <Text variant="meta" tone="secondary" as="p">
          {line}
        </Text>
      )}
      {action}
    </Stack>
  );
}

function LoadingCells(): JSX.Element {
  return (
    <Stack gap="sm">
      <span role="status">
        <Text variant="small" tone="secondary">
          Loading GIFs
        </Text>
      </span>
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} shape="rect" height="lg" />
      ))}
    </Stack>
  );
}

export function GifPickerSheet({ touch, opener, onPick, onDone }: GifPickerSheetProps): JSX.Element {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  const gifs = useGifSearch(query);
  const search = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const picked = useRef<GifResultDto | null>(null);

  useEffect(() => {
    if (touch) return;
    const frame = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [touch]);

  useEffect(() => {
    if (open) return;
    const gif = picked.current;
    if (gif !== null) onPick(gif);
    onDone();
  }, [open, onPick, onDone]);

  const byId = useMemo(() => new Map(gifs.gifs.map((gif) => [gif.id, gif])), [gifs.gifs]);
  const sections = useMemo(
    () => [
      {
        id: 'gifs',
        items: gifs.gifs.map((gif) => ({ id: gif.id, label: gif.title || 'GIF', src: gif.previewUrl || gif.url })),
      },
    ],
    [gifs.gifs],
  );
  const pick = useCallback(
    (item: PickerGridItem) => {
      const gif = byId.get(item.id);
      if (gif === undefined) return;
      picked.current = gif;
      setOpen(false);
    },
    [byId],
  );
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = gifs;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const body = gifs.isLoading ? (
    <LoadingCells />
  ) : gifs.isError ? (
    <Notice
      title="Couldn't load GIFs"
      line="GIF search may be unavailable on this server."
      action={<Button onClick={() => gifs.refetch()}>Try again</Button>}
    />
  ) : gifs.gifs.length === 0 ? (
    <Notice title="No GIFs found" line={gifs.debouncedQuery ? 'Try a different word.' : undefined} />
  ) : (
    <PickerGrid
      label="GIFs"
      variant="media"
      sections={sections}
      onPick={pick}
      loadMore={hasNextPage ? loadMore : undefined}
      footer={
        isFetchingNextPage ? (
          <Stack gap="xs" align="start">
            <Spinner label="Loading more GIFs" />
          </Stack>
        ) : undefined
      }
    />
  );

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title="GIFs"
      size="lg"
      opener={opener}
      top={
        <TextField
          ref={search}
          label="Search GIFs"
          labelHidden
          type="search"
          shape="round"
          startIcon="Search"
          placeholder="Search GIFs"
          value={query}
          onChange={setQuery}
        />
      }
    >
      {body}
    </Sheet>
  );
}
