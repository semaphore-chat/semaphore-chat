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
import { useState, type JSX } from 'react';
import { AvatarStack, Button, Card, Icon, Pill, Text, useToasts } from '../../../../kit';
import type { Channel } from '../../../../types/channel.type';
import { useVoiceRoomPeople, useJoinVoiceRoom } from '../../../../data/voiceRoom';
import { useChannelPermissions } from '../../../../hooks/useChannelPermissions';
import { useVoiceConnection } from '../../../../hooks/useVoiceConnection';
import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import { useAuthenticatedImage } from '../../../../hooks/useAuthenticatedImage';
import { column, fixed, grow, row } from '../arrange';
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

export function VoiceRoomCard({
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
  const talking = youAreHere ? talkingLine(people, speaking, youId) : null;
  const stack = people.map((p) => ({
    name: p.name,
    src: p.src,
    speaking: youAreHere && speaking.has(p.id),
  }));

  let action: JSX.Element | null = null;
  if (youAreHere) {
    action = (
      <Button variant="soft" size="sm" onClick={onLeave} aria-label={`Leave ${name}`}>
        Leave
      </Button>
    );
  } else if (canJoin) {
    action = (
      <Button variant="soft" size="sm" onClick={onJoin} loading={joining} aria-label={`Join ${name}`}>
        Join
      </Button>
    );
  }

  return (
    <Card selected={youAreHere}>
      <div style={row('sm')}>
        <div style={fixed}>
          <Icon name="Volume2" tone="secondary" />
        </div>
        <div style={{ ...grow, ...column('2xs') }}>
          <Text variant="name" as="h3" truncate>
            {name}
          </Text>
          {youAreHere && (
            <div>
              <Pill tone="accent" size="sm">
                You're here
              </Pill>
            </div>
          )}
        </div>
        {action && <div style={fixed}>{action}</div>}
      </div>
      {people.length > 0 ? (
        <div style={row('sm')}>
          <div style={fixed}>
            <AvatarStack people={stack} size="sm" />
          </div>
          <div style={{ ...grow, ...column() }}>
            <Text variant="meta" tone="secondary" truncate>
              {peopleLine(people, youId)}
            </Text>
            {talking && (
              <Text variant="meta" tone="accent" truncate>
                {talking}
              </Text>
            )}
          </div>
        </div>
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
  const toasts = useToasts();
  const [pending, setPending] = useState(false);
  const sources = useStackSources(people);

  const joining = pending || (state.isConnecting && state.currentChannelId === room.id);

  const startJoin = async (): Promise<void> => {
    setPending(true);
    try {
      const outcome = await join(room, communityId);
      // PR 7 shows the voice notice (useVoiceNotice) in the call slot; until then the failure is a toast.
      if (outcome === 'failed') {
        toasts.show({
          id: 'voice-join-failed',
          tone: 'danger',
          message: `Couldn't join ${room.name}`,
          action: { label: 'Try again', onAction: () => startJoin() },
        });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <VoiceRoomCard
      name={room.name}
      people={people.map((p, i) => ({ id: p.id, name: p.name, src: sources[i] }))}
      youId={user?.id ?? null}
      speaking={speaking}
      youAreHere={youAreHere}
      canJoin={can('connect')}
      joining={joining}
      onJoin={() => void startJoin()}
      onLeave={() => actions.leaveVoiceChannel()}
    />
  );
}
