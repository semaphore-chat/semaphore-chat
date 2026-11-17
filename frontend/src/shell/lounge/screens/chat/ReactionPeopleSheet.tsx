/**
 * Who reacted to a message (the old chat's reaction tooltip, as a phone can show it): a kit Sheet with one group per
 * reaction, its people by name (the first 15, then "and N more", as the old tooltip: `useReactionPeople`). Opened by a
 * long press, right-click or context-menu key on a reaction (that reaction's group first) or by "See reactions" in
 * the message's actions. Read-only: it works where the reader may not react.
 */
import { useEffect, useState, type JSX } from 'react';
import { Avatar, ListRow, Sheet, Skeleton, Stack, Text, personColour } from '../../../../kit';
import { toReactionViews, type ReactionContext, type ReactionView } from '../../../../data/chat/messageRowModel';
import { useReactionPeople } from '../../../../data/chat/useReactionPeople';
import type { Message } from '../../../../types/message.type';

export interface ReactionPeopleRequest {
  message: Message;
  /** The reaction asked about: its group comes first. */
  reactionKey?: string;
  /** Where focus returns when the sheet closes (the row, or the chip that asked). */
  returnTo?: HTMLElement | null;
}

export interface ReactionPeopleSheetProps {
  request: ReactionPeopleRequest | null;
  me: string;
  emoji: ReactionContext;
  onDone: () => void;
}

export function ReactionPeopleSheet({ request, ...rest }: ReactionPeopleSheetProps): JSX.Element | null {
  if (request === null) return null;
  return <PeopleFor key={`${request.message.id}:${request.reactionKey ?? ''}`} request={request} {...rest} />;
}

function PeopleFor({ request, me, emoji, onDone }: ReactionPeopleSheetProps & { request: ReactionPeopleRequest }): JSX.Element {
  const [open, setOpen] = useState(true);
  const { message, reactionKey } = request;
  const views = toReactionViews(message.reactions, me, emoji);
  const first = views.findIndex((v) => v.key === reactionKey);
  const ordered = first > 0 ? [views[first], ...views.slice(0, first), ...views.slice(first + 1)] : views;
  const close = () => setOpen(false);
  // Done once the sheet has closed (the overlay stack has handed focus back first).
  useEffect(() => {
    if (!open) onDone();
  }, [open, onDone]);
  return (
    <Sheet open={open} onClose={close} title="Reactions" opener={request.returnTo ?? null}>
      <Stack gap="lg">
        {ordered.length === 0 ? (
          <Text tone="secondary">No reactions.</Text>
        ) : (
          ordered.map((view) => (
            <Group key={view.key} view={view} userIds={message.reactions.find((r) => r.emoji === view.key)?.userIds ?? []} />
          ))
        )}
      </Stack>
    </Sheet>
  );
}

function Group({ view, userIds }: { view: ReactionView; userIds: string[] }): JSX.Element {
  const { people, more } = useReactionPeople(userIds);
  // The emoji (a custom one's `:name:`) and the count: its name is the region's label, not said twice.
  const heading = `${view.emoji} · ${view.count}`;
  return (
    <section aria-label={`${view.label}, ${view.count}`}>
      <Stack gap="xs">
        <Text variant="section">{heading}</Text>
        {people.map((person) =>
          person.name === null ? (
            <ListRow key={person.id} primary="Loading…" muted leading={<Skeleton shape="circle" size="sm" />} />
          ) : (
            <ListRow
              key={person.id}
              primary={person.name}
              leading={<Avatar decorative name={person.name} colour={personColour(person.id)} size="sm" />}
            />
          ),
        )}
        {more > 0 && <Text tone="secondary">{`and ${more} more`}</Text>}
      </Stack>
    </section>
  );
}
