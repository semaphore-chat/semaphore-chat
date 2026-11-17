/**
 * The chat's header (design §3 PR 10c, B6): Back to the community, the channel's name as the screen's heading (a
 * lock when it is private), Members (where they are not beside the list), and More with Search, which is the old
 * shell's search screen (owner default: phone search stays classic), and Pinned messages with their count (PR 10d-B).
 */
import { useRef, useState, type JSX } from 'react';
import { Icon, IconButton, Menu, Skeleton, Stack, Text, type MenuEntry } from '../../../../kit';

export interface ChatHeaderProps {
  /** "# lobby"; null while the channel loads. */
  title: string | null;
  isPrivate: boolean;
  onBack: () => void;
  /** Opens the members; undefined while they are shown beside the list (wide). */
  onShowMembers?: () => void;
  /** The More menu's Search; undefined: no More menu (a voice channel has nothing to search). */
  onSearch?: () => void;
  /** The More menu's Pinned messages; `opener` is the More button (focus returns there when the list closes). */
  onShowPinned?: (opener: HTMLElement | null) => void;
  /** How many messages are pinned, for the menu's label. */
  pinnedCount?: number;
}

export function ChatHeader({ title, isPrivate, onBack, onShowMembers, onSearch, onShowPinned, pinnedCount }: ChatHeaderProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const items: MenuEntry[] = [
    {
      id: 'search',
      label: 'Search messages',
      icon: 'Search',
      onSelect: () => {
        setOpen(false);
        onSearch?.();
      },
    },
    ...(onShowPinned !== undefined
      ? [
          {
            id: 'pinned',
            label: pinnedCount ? `Pinned messages (${pinnedCount})` : 'Pinned messages',
            icon: 'Pin' as const,
            onSelect: () => {
              setOpen(false);
              onShowPinned(more.current);
            },
          },
        ]
      : []),
  ];
  return (
    <Stack direction="row" gap="sm">
      <IconButton icon="ArrowLeft" label="Back to the community" variant="ghost" onClick={onBack} />
      <Stack direction="row" gap="xs" fill>
        {title === null ? (
          <Skeleton shape="text" />
        ) : (
          <Text variant="title" as="h1" truncate>
            {title}
          </Text>
        )}
        {isPrivate && <Icon name="Lock" size="sm" tone="secondary" label="Private channel" />}
      </Stack>
      {onShowMembers !== undefined && <IconButton icon="Users" label="Members" variant="ghost" onClick={onShowMembers} />}
      {onSearch !== undefined && (
        <>
          <IconButton
            ref={more}
            icon="Ellipsis"
            label="More"
            variant="ghost"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
          />
          <Menu open={open} anchor={more.current} onClose={() => setOpen(false)} label="Channel menu" items={items} placement="bottom-end" />
        </>
      )}
    </Stack>
  );
}
