/**
 * The community's header at the top of the left island (design §3.3): avatar, name and "N around",
 * on a Card as in the mock-ups. When the user may do something to the community, a menu button at
 * its end opens a Menu of exactly those actions (today only "Community settings", the classic app's
 * edit, `useCommunityActions`). With no permitted action there is no button at all: the header is a
 * plain heading.
 */
import { useRef, useState, type JSX } from 'react';
import { Avatar, Card, IconButton, Menu, Skeleton, Stack, Text, type MenuEntry } from '../../../../kit';
import { aroundLine } from './lines';

export type CommunityAction = 'settings';

export interface CommunityHeaderProps {
  /** Null while the community loads. */
  name: string | null;
  src?: string;
  /** Online members in the whole community; null when no source knows it (no number then). */
  aroundCount: number | null;
  /** What the user may do here (from `useCommunityActions`), in menu order. */
  actions: readonly CommunityAction[];
  onAction(action: CommunityAction): void;
}

const ACTION_LABEL: Record<CommunityAction, { label: string; icon: 'Settings' }> = {
  settings: { label: 'Community settings', icon: 'Settings' },
};

export function CommunityHeader({ name, src, aroundCount, actions, onAction }: CommunityHeaderProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const line = aroundLine(aroundCount);

  if (name === null) {
    return (
      <Card>
        <Stack direction="row" gap="md">
          <Skeleton shape="circle" size="lg" />
          <Stack gap="xs" fill>
            <Skeleton shape="text" lines={2} />
          </Stack>
        </Stack>
      </Card>
    );
  }

  const items: MenuEntry[] = actions.map((action) => ({
    id: action,
    label: ACTION_LABEL[action].label,
    icon: ACTION_LABEL[action].icon,
    onSelect: () => {
      setOpen(false);
      onAction(action);
    },
  }));

  return (
    <Card>
      <Stack direction="row" gap="md">
        <Avatar decorative name={name} src={src} shape="rounded" size="lg" />
        <Stack gap="xs" fill>
          <Text variant="title" as="h2" truncate>
            {name}
          </Text>
          {line !== null && (
            <Text variant="meta" tone="secondary" truncate>
              {line}
            </Text>
          )}
        </Stack>
        {items.length > 0 && (
          <>
            <IconButton
              ref={button}
              icon="ChevronDown"
              label={`${name}, community menu`}
              variant="soft"
              size="sm"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((was) => !was)}
            />
            <Menu
              open={open}
              anchor={button.current}
              onClose={() => setOpen(false)}
              label={`${name} menu`}
              items={items}
              placement="bottom-end"
            />
          </>
        )}
      </Stack>
    </Card>
  );
}
