/**
 * The user's own card at the foot of the left island (design §3.3; compact and wide only, a phone has
 * none): avatar with presence, name, a line ("In Squad Up" in a call, else the status text), and in a
 * call the mute and deafen toggles from the call bar model (the one model both shells read, so
 * push-to-talk, server mute and a missing SPEAK permission say what they say on the classic bar).
 * Settings goes to the classic settings screen.
 */
import { startTransition, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Card, IconButton, Text } from '../../../../kit';
import { useCallBarModel } from '../../../../data/callBar';
import { useConnectionState } from '../../../../data/connection';
import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import { useAuthenticatedImage } from '../../../../hooks/useAuthenticatedImage';
import { column, fixed, grow, row } from '../arrange';

export interface UserCardMic {
  muted: boolean;
  /** Tapping cannot change the mic now (push-to-talk, server mute, no permission). */
  disabled: boolean;
  /** What the control does now, or why it can't ("Hold V to talk"). */
  title: string;
}

export interface UserCardProps {
  /** Null while your profile loads. */
  name: string | null;
  src?: string;
  online: boolean;
  /** "In Squad Up", or your status text; null for none. */
  line: string | null;
  /** In a call: the mic and deafen state. Null out of a call (no toggles). */
  call: { mic: UserCardMic; deafened: boolean; onMute(): void; onDeafen(): void } | null;
  onSettings(): void;
}

export function UserCard({ name, src, online, line, call, onSettings }: UserCardProps): JSX.Element {
  const shownName = name ?? 'Your profile';
  return (
    <Card padding="md">
      <div style={row('sm')}>
        <div style={fixed}>
          <Avatar name={shownName} src={src} presence={online ? 'online' : 'offline'} />
        </div>
        <div style={{ ...grow, ...column() }}>
          <Text variant="name" truncate>
            {shownName}
          </Text>
          <Text variant="meta" tone="secondary" truncate>
            {line ?? (online ? 'Online' : 'Offline')}
          </Text>
        </div>
        <div style={{ ...fixed, ...row('xs') }}>
          {call && (
            <>
              <IconButton
                icon={call.mic.muted ? 'MicOff' : 'Mic'}
                label="Mute"
                title={call.mic.title}
                size="sm"
                selected={call.mic.muted}
                disabled={call.mic.disabled}
                onClick={call.onMute}
              />
              <IconButton
                icon={call.deafened ? 'HeadphoneOff' : 'Headphones'}
                label="Deafen"
                size="sm"
                selected={call.deafened}
                onClick={call.onDeafen}
              />
            </>
          )}
          <IconButton icon="Settings" label="Settings" size="sm" onClick={onSettings} />
        </div>
      </div>
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

  const line = model ? `In ${model.place.name}` : (user?.status ?? null);
  const call = model
    ? {
        mic: {
          muted: !model.mic.on,
          disabled: !model.mic.tappable || model.mic.blocked,
          title: model.mic.title,
        },
        deafened: model.deafened,
        onMute: model.actions.toggleMute,
        onDeafen: model.actions.toggleDeafen,
      }
    : null;

  return (
    <UserCard
      name={user ? user.displayName || user.username : null}
      src={blobUrl ?? undefined}
      online={connection === 'connected'}
      line={line || null}
      call={call}
      onSettings={() => startTransition(() => navigate('/settings'))}
    />
  );
}
