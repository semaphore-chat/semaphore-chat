/**
 * The community's header at the top of the left island (design §3.3): avatar, name and "N around",
 * on a Card as in the mock-ups. When the user may do something to the community, a menu button at
 * its end opens a Menu of exactly those actions (today only "Community settings", the classic app's
 * edit, `useCommunityActions`). With no permitted action there is no button at all: the header is a
 * plain heading.
 */
import { useRef, useState, type JSX } from 'react';
import { Avatar, Card, IconButton, Menu, Skeleton, Text, type MenuEntry } from '../../../../kit';
import { column, fixed, grow, row } from '../arrange';
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
        <div style={row('md')}>
          <Skeleton shape="circle" size="lg" />
          <div style={grow}>
            <Skeleton shape="text" lines={2} />
          </div>
        </div>
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
      <div style={row('md')}>
        <div style={fixed}>
          <Avatar decorative name={name} src={src} shape="rounded" size="lg" />
        </div>
        <div style={{ ...grow, ...column() }}>
          <Text variant="title" as="h2" truncate>
            {name}
          </Text>
          {line !== null && (
            <Text variant="meta" tone="secondary" truncate>
              {line}
            </Text>
          )}
        </div>
        {items.length > 0 && (
          <div style={fixed}>
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
          </div>
        )}
      </div>
    </Card>
  );
}
