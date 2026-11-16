/**
 * The user's own card at the foot of the left island (design §3.3; compact and wide only, a phone has
 * none): avatar with presence, name, a line ("In Squad Up" in a call, else the status text), and in a
 * call the mic and deafen STATE as status (an icon and words, no buttons: the call controls live on the
 * call bar at every width). The state comes from the call bar model, the one model both shells read, so
 * push-to-talk, server mute and a missing SPEAK permission read as they do on the classic bar.
 * Settings goes to the classic settings screen.
 */
import { startTransition, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Card, Icon, IconButton, Skeleton, Stack, Text } from '../../../../kit';
import { useCallBarModel } from '../../../../data/callBar';
import { callFromModel, callState } from './lines';
import { useConnectionState } from '../../../../data/connection';
import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import { useAuthenticatedImage } from '../../../../hooks/useAuthenticatedImage';

/** Your mic in the call, as status. */
export type UserCardMic = 'on' | 'muted' | 'serverMuted' | 'blocked' | 'pushToTalk';

export interface UserCardCall {
  mic: UserCardMic;
  deafened: boolean;
  /** The push-to-talk key ("V"), when `mic` is `pushToTalk`. */
  keyLabel?: string | null;
}

export interface UserCardProps {
  /** Null while your profile loads. */
  name: string | null;
  src?: string;
  online: boolean;
  /** "In Squad Up", or your status text; null for none. */
  line: string | null;
  /** In a call: how your mic and sound are. Null out of a call. */
  call: UserCardCall | null;
  onSettings(): void;
}

export function UserCard({ name, src, online, line, call, onSettings }: UserCardProps): JSX.Element {
  const state = call ? callState(call) : null;
  if (name === null) {
    return (
      <Card padding="md">
        <Stack direction="row" gap="sm">
          <Skeleton shape="circle" size="md" />
          <Stack gap="xs" fill>
            <Skeleton shape="text" lines={2} />
          </Stack>
          <IconButton icon="Settings" label="Settings" size="sm" onClick={onSettings} />
        </Stack>
      </Card>
    );
  }
  const shownName = name;
  return (
    <Card padding="md">
      <Stack direction="row" gap="sm">
        <Avatar name={shownName} src={src} presence={online ? 'online' : 'offline'} />
        <Stack gap="xs" fill>
          <Text variant="name" truncate>
            {shownName}
          </Text>
          <Text variant="meta" tone="secondary" truncate>
            {line ?? (online ? 'Online' : 'Offline')}
          </Text>
          {state && (
            <Stack direction="row" gap="xs">
              <Icon name={state.icon} size="xs" tone={call?.mic === 'on' && !call.deafened ? 'positive' : 'secondary'} />
              <Stack gap="xs" fill>
                <Text variant="meta" tone="secondary" truncate>
                  {state.text}
                </Text>
              </Stack>
            </Stack>
          )}
        </Stack>
        <IconButton icon="Settings" label="Settings" size="sm" onClick={onSettings} />
      </Stack>
    </Card>
  );
}

/** The card with your profile, your connection and the call you are in. */
export function UserCardConnected(): JSX.Element {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const connection = useConnectionState();
  const model = useCallBarModel(false);
  const { blobUrl } = useAuthenticatedImage(user?.avatarUrl ?? null);

  // While a join runs the card says so (the model already names the room being joined).
  const line = model ? `${model.phase === 'connecting' ? 'Joining' : 'In'} ${model.place.name}` : (user?.status ?? null);
  return (
    <UserCard
      name={user ? user.displayName || user.username : null}
      src={blobUrl ?? undefined}
      online={connection === 'connected'}
      line={line || null}
      call={model ? callFromModel(model) : null}
      onSettings={() => startTransition(() => navigate('/settings'))}
    />
  );
}
