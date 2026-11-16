/**
 * A voice room in the left island (design §3.3): a plain Card with the room's name, who is in it
 * (an AvatarStack, and their names), and Join or Leave. The room you are in wears the accent outline
 * ("You're here") and shows who is talking; speaking is only known in your own room. Joining stays on
 * this screen (design PA-2): the call view is the call bar's "Open call view".
 *
 * A clickable Card cannot hold a second control (the guide), so the card is plain and Join / Leave
 * are its buttons. Join is offered only when the classic pre-join screen would offer it
 * (`useChannelPermissions(...).can('connect')`).
 */
import { memo, useCallback, useMemo, useState, type JSX } from 'react';
import { AvatarStack, Button, Card, Icon, Pill, Stack, Text, useWidthRange } from '../../../../kit';
import type { Channel } from '../../../../types/channel.type';
import { useVoiceRoomPeople, useJoinVoiceRoom } from '../../../../data/voiceRoom';
import { useChannelPermissions } from '../../../../hooks/useChannelPermissions';
import { useVoiceConnection } from '../../../../hooks/useVoiceConnection';
import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import { useAuthenticatedImage } from '../../../../hooks/useAuthenticatedImage';
import { peopleLine, talkingLine } from './lines';

export interface VoiceRoomPersonView {
  id: string;
  name: string;
  src?: string;
}

export interface VoiceRoomCardProps {
  name: string;
  people: readonly VoiceRoomPersonView[];
  /** Your user id, to say "You" (null before your profile loads). */
  youId: string | null;
  /** Who is talking; empty outside your own room. */
  speaking: ReadonlySet<string>;
  youAreHere: boolean;
  /** Join is allowed here (the classic pre-join rule). */
  canJoin: boolean;
  /** Your join to this room is running. */
  joining: boolean;
  onJoin(): void;
  onLeave(): void;
}

function VoiceRoomCardView({
  name,
  people,
  youId,
  speaking,
  youAreHere,
  canJoin,
  joining,
  onJoin,
  onLeave,
}: VoiceRoomCardProps): JSX.Element {
  // A touch-sized button on a phone; the column's compact rows elsewhere.
  const size = useWidthRange() === 'phone' ? 'md' : 'sm';
  const talking = youAreHere ? talkingLine(people, speaking, youId) : null;
  const stack = people.map((p) => ({
    name: p.name,
    src: p.src,
    speaking: youAreHere && speaking.has(p.id),
  }));

  let action: JSX.Element | null = null;
  if (youAreHere) {
    action = (
      <Button variant="soft" size={size} onClick={onLeave} aria-label={`Leave ${name}`}>
        Leave
      </Button>
    );
  } else if (canJoin) {
    action = (
      <Button variant="soft" size={size} onClick={onJoin} loading={joining} aria-label={`Join ${name}`}>
        Join
      </Button>
    );
  }

  return (
    <Card selected={youAreHere}>
      <Stack direction="row" gap="sm">
        <Icon name="Volume2" tone="secondary" />
        <Stack gap="xs" fill align="start">
          <Text variant="name" as="h3" truncate>
            {name}
          </Text>
          {youAreHere && (
            <Pill tone="accent" size="sm">
              You're here
            </Pill>
          )}
        </Stack>
        {action}
      </Stack>
      {people.length > 0 ? (
        <Stack direction="row" gap="sm">
          <AvatarStack people={stack} size="sm" />
          <Stack gap="xs" fill>
            <Text variant="meta" tone="secondary" truncate>
              {peopleLine(people, youId, youAreHere)}
            </Text>
            {talking && (
              <Text variant="meta" tone="accent" truncate>
                {talking}
              </Text>
            )}
          </Stack>
        </Stack>
      ) : (
        <Text variant="meta" tone="secondary">
          Nobody here
        </Text>
      )}
      {!youAreHere && !canJoin && (
        <Text variant="meta" tone="dim">
          You can't join this room
        </Text>
      )}
    </Card>
  );
}

/** The first three people's pictures (the stack shows three): a fixed number of hooks. */
function useStackSources(people: readonly { avatarFileId: string | null }[]): (string | undefined)[] {
  const a = useAuthenticatedImage(people[0]?.avatarFileId ?? null).blobUrl ?? undefined;
  const b = useAuthenticatedImage(people[1]?.avatarFileId ?? null).blobUrl ?? undefined;
  const c = useAuthenticatedImage(people[2]?.avatarFileId ?? null).blobUrl ?? undefined;
  return [a, b, c];
}

/**
 * Memoised: during a call each speaking change reaches every room's hook, but only your own room's props change
 * (people, speaking and the callbacks keep their identity elsewhere), so only that card renders again.
 */
export const VoiceRoomCard = memo(VoiceRoomCardView);

export interface VoiceRoomCardConnectedProps {
  room: Channel;
  communityId: string;
}

/** A room card with live presence, permissions and the shared join. */
export function VoiceRoomCardConnected({ room, communityId }: VoiceRoomCardConnectedProps): JSX.Element {
  const { people, speaking, youAreHere } = useVoiceRoomPeople(room);
  const { can } = useChannelPermissions(communityId, room.id);
  const join = useJoinVoiceRoom();
  const { state, actions } = useVoiceConnection();
  const { user } = useCurrentUser();
  // How many joins from this card are running.
  const [pending, setPending] = useState(0);
  const [a, b, c] = useStackSources(people);

  const joining = pending > 0 || (state.isConnecting && state.currentChannelId === room.id);

  // A failed join says nothing here: the join records it in the voice state, and the call slot's voice notice (the
  // one place a failed join shows in the Lounge) says why, with Retry.
  const startJoin = useCallback(async (): Promise<void> => {
    setPending((n) => n + 1);
    try {
      await join(room, communityId);
    } finally {
      setPending((n) => n - 1);
    }
  }, [join, room, communityId]);

  const shown = useMemo(
    () => people.map((p, i) => ({ id: p.id, name: p.name, src: [a, b, c][i] })),
    [people, a, b, c],
  );
  const onJoin = useCallback(() => void startJoin(), [startJoin]);
  const { leaveVoiceChannel } = actions;
  const onLeave = useCallback(() => leaveVoiceChannel(), [leaveVoiceChannel]);

  return (
    <VoiceRoomCard
      name={room.name}
      people={shown}
      youId={user?.id ?? null}
      speaking={speaking}
      youAreHere={youAreHere}
      canJoin={can('connect')}
      joining={joining}
      onJoin={onJoin}
      onLeave={onLeave}
    />
  );
}
