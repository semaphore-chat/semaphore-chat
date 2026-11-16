/**
 * The user's own card at the foot of the left island (design §3.3; compact and wide only, a phone has
 * none): avatar with presence, name, a line ("In Squad Up" in a call, else the status text), and in a
 * call the mic and deafen STATE as status (an icon and words, no buttons: the call controls live on the
 * call bar at every width). The state comes from the call bar model, the one model both shells read, so
 * push-to-talk, server mute and a missing SPEAK permission read as they do on the classic bar.
 * The account menu at its end: Settings and Your profile (the classic screens), and Sign out…, asked first
 * (the kit's confirm host over the app's one sign-out).
 */
import { startTransition, useRef, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Card, Icon, IconButton, Menu, Skeleton, Stack, Text, type MenuEntry } from '../../../../kit';
import { useSignOutConfirm } from '../signOutConfirm';
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
  onProfile(): void;
  /** Sign out… : the connected card opens the confirmation. */
  onSignOut(): void;
}

export const ACCOUNT_MENU_LABEL = 'Account menu';

type AccountMenuProps = Pick<UserCardProps, 'onSettings' | 'onProfile' | 'onSignOut'>;

/** The card's one button: a menu of the account's places and Sign out…. */
function AccountMenu({ onSettings, onProfile, onSignOut }: AccountMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  const items: MenuEntry[] = [
    { id: 'settings', label: 'Settings', icon: 'Settings', onSelect: choose(onSettings) },
    { id: 'profile', label: 'Your profile', icon: 'User', onSelect: choose(onProfile) },
    { id: 'sign-out', label: 'Sign out…', icon: 'LogOut', tone: 'danger', onSelect: choose(onSignOut) },
  ];
  return (
    <>
      <IconButton
        ref={button}
        icon="Settings"
        label={ACCOUNT_MENU_LABEL}
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      />
      <Menu
        open={open}
        anchor={button.current}
        onClose={() => setOpen(false)}
        label={ACCOUNT_MENU_LABEL}
        items={items}
        placement="top-end"
      />
    </>
  );
}

export function UserCard({ name, src, online, line, call, onSettings, onProfile, onSignOut }: UserCardProps): JSX.Element {
  const state = call ? callState(call) : null;
  const menu = <AccountMenu onSettings={onSettings} onProfile={onProfile} onSignOut={onSignOut} />;
  if (name === null) {
    return (
      <Card padding="md">
        <Stack direction="row" gap="sm">
          <Skeleton shape="circle" size="md" />
          <Stack gap="xs" fill>
            <Skeleton shape="text" lines={2} />
          </Stack>
          {menu}
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
        {menu}
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
  const signOut = useSignOutConfirm();

  // While a join runs the card says so (the model already names the room being joined).
  const line = model ? `${model.phase === 'connecting' ? 'Joining' : 'In'} ${model.place.name}` : (user?.status ?? null);
  return (
    <>
      <UserCard
        name={user ? user.displayName || user.username : null}
        src={blobUrl ?? undefined}
        online={connection === 'connected'}
        line={line || null}
        call={model ? callFromModel(model) : null}
        onSettings={() => startTransition(() => navigate('/settings'))}
        onProfile={() => startTransition(() => navigate('/profile'))}
        onSignOut={signOut.request}
      />
      {signOut.dialog}
    </>
  );
}
