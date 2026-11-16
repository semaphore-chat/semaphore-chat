/**
 * The community left island (shell/lounge/pieces/community, design §3.3) in the real ThreeIslands
 * template: the header and its menu, the channels, the voice rooms and the user's card. Views with the
 * mock-ups' sample data; the connected island is in the `lounge-frame--three-islands-*` stories.
 * A phone shows the left pane (a community home) and no user card.
 */
import type { JSX } from 'react';
import { useConfirmDestructive } from '../../kit';
import { SIGN_OUT_DESCRIPTION, SIGN_OUT_LABEL, SIGN_OUT_TITLE } from '../../shell/lounge/pieces/signOutText';
import { ClickOnMount } from '../fixtures/interactions';
import { CommunityLeftView, type CommunityLeftViewProps } from '../../shell/lounge/pieces/community/CommunityLeft';
import { VoiceRoomCard, type VoiceRoomCardProps } from '../../shell/lounge/pieces/community/VoiceRoomCard';
import { UserCard } from '../../shell/lounge/pieces/community/UserCard';
import { MembersIsland } from '../../shell/lounge/pieces/MembersIsland';
import type { ModeName } from '../../theme/derive/derivePalette';
import {
  AFK,
  AROUND,
  AWAY,
  CHANNELS,
  failed,
  FIVE_CHANNELS,
  HEADER,
  HOSTS,
  loading,
  LONG,
  manyChannels,
  noop,
  NOW,
  ready,
  room,
  SQUAD,
  SQUAD_HERE,
  TWELVE,
  USER_IDLE,
  USER_DEAFENED,
  USER_IN_CALL,
  USER_MUTED,
  USER_SERVER_MUTED,
  useUserCardShown,
} from '../fixtures/loungeCommunity';
import { CommunityPage } from '../fixtures/LoungeCommunityPage';

interface LeftOptions {
  mode?: ModeName;
  view?: Partial<Omit<CommunityLeftViewProps, 'rooms'>>;
  channels?: Partial<CommunityLeftViewProps['channels']>;
  rooms?: VoiceRoomCardProps[];
  user?: typeof USER_IN_CALL | null;
  members?: boolean;
  /** Open the user card's account menu; `signOut` goes on to its Sign out… (the question). */
  account?: 'menu' | 'signOut';
}

/** The sign-out question as the connected card asks it; nothing is signed out in a story. */
const NEVER = () => new Promise<void>(() => undefined);

/**
 * What the account stories press. Module-level so their identity never changes: ClickOnMount runs again
 * when `find` changes, and a new function each render would press again on every render (a loop).
 */
const findAccountMenu = (): HTMLElement | null => document.querySelector<HTMLElement>('button[aria-label="Account menu"]');
const findSignOutItem = (): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim() === 'Sign out…') ?? null;

/** The user card with the sign-out question as the connected card asks it (inside the page's KitProvider). */
function StoryUserCard({ user, account }: { user: typeof USER_IN_CALL; account?: LeftOptions['account'] }): JSX.Element {
  const signOut = useConfirmDestructive({ title: SIGN_OUT_TITLE, description: SIGN_OUT_DESCRIPTION, confirmLabel: SIGN_OUT_LABEL, run: NEVER });
  return (
    <>
      <UserCard {...user} onSignOut={signOut.request} />
      {signOut.dialog}
      {account && <ClickOnMount find={findAccountMenu} />}
      {account === 'signOut' && <ClickOnMount find={findSignOutItem} />}
    </>
  );
}

function Left({ mode, view, channels, rooms = [SQUAD_HERE, AFK], user = USER_IN_CALL, members = false, account }: LeftOptions): JSX.Element {
  const userShown = useUserCardShown();
  return (
    <CommunityPage
      mode={mode}
      left={
        <CommunityLeftView
          access="ok"
          header={HEADER}
          onLeave={noop}
          {...view}
          channels={{
            channels: CHANNELS,
            selectedId: 'ch-general',
            hrefFor: (id) => `#${id}`,
            state: ready(),
            ...channels,
          }}
          rooms={rooms.map((r) => (
            <VoiceRoomCard key={r.name} {...r} />
          ))}
        />
      }
      leftFooter={userShown && user ? <StoryUserCard user={user} account={account} /> : undefined}
      right={
        members ? (
          <MembersIsland
            hosts={HOSTS}
            around={AROUND}
            away={AWAY}
            aroundCount={9}
            allLoaded
            onLoadMore={noop}
            loadingMore={false}
            state={ready()}
            onOpenProfile={noop}
            now={NOW}
          />
        ) : undefined
      }
    />
  );
}

/** The mock-up (Chat): in Squad Up with dropbear talking, general selected, clips with 2 mentions; the members beside. */
export const Default = () => <Left members />;

/** The same, light. */
export const Light = () => <Left mode="light" members />;

/** Not in a call: every room offers Join, the user card has no mute or deafen. */
export const NotInCall = () => (
  <Left rooms={[room({ name: 'Squad Up', people: SQUAD.slice(0, 2) }), AFK]} user={USER_IDLE} />
);

/** Rooms: empty, three people, twelve people (+N), one joining. */
export const VoiceRooms = () => (
  <Left
    user={USER_IDLE}
    rooms={[
      room({ name: 'Squad Up', people: SQUAD.slice(0, 2).concat({ id: 'u-aiko', name: 'aiko' }) }),
      room({ name: 'Raid night', people: TWELVE.filter((p) => p.id !== 'u-alexk').concat({ id: 'u-x', name: 'xan' }) }),
      room({ name: 'AFK', people: [] }),
      room({ name: 'Movie night', people: [], joining: true }),
    ]}
  />
);

/** You are here with twelve, two talking. */
export const HereWithTwelve = () => (
  <Left rooms={[room({ name: 'Squad Up', people: TWELVE, youAreHere: true, speaking: new Set(['u-dropbear', 'u-pri']) }), AFK]} />
);

/** Joining is not allowed in one room (no permission): no Join, a note instead. */
export const CannotJoin = () => (
  <Left user={USER_IDLE} rooms={[room({ name: 'Staff call', people: SQUAD.slice(0, 2), canJoin: false }), AFK]} />
);

/** A plain member: no community menu, the header is not a button. */
export const NoPermission = () => <Left view={{ header: { ...HEADER, actions: [] } }} />;

/** No "N around": the whole community's online count is not known. */
export const NoAroundCount = () => <Left view={{ header: { ...HEADER, aroundCount: null } }} />;

/** Six channels: an announcement channel (megaphone), two private, unread without a mention (bold) beside mentions, lfg selected. */
export const FiveChannels = () => <Left channels={{ channels: FIVE_CHANNELS, selectedId: 'ch-lfg' }} />;

/** The server lists you in Squad Up but this device is not connected (you are in it on another device): Join stays. */
export const HereOnAnotherDevice = () => (
  <Left user={USER_IDLE} rooms={[room({ name: 'Squad Up', people: SQUAD }), AFK]} />
);

/** No channels yet (and no voice rooms). */
export const ZeroChannels = () => <Left channels={{ channels: [], state: ready(true) }} rooms={[]} />;

/** Voice rooms but no text channel: "No text channels yet". */
export const NoTextChannels = () => <Left channels={{ channels: [], state: ready(true), hasRooms: true }} />;

/** 200 channels: the island scrolls, the user card stays at its foot. */
export const TwoHundredChannels = () => <Left channels={{ channels: manyChannels(200), selectedId: 'ch-3' }} />;

/** Long names everywhere: they cut with an ellipsis, nothing scrolls sideways. */
export const LongNames = () => (
  <Left
    view={{ header: { ...HEADER, name: 'The Couch Co-op and Friends of the Couch International Society' } }}
    channels={{
      channels: [
        { id: 'ch-long', name: LONG, unread: true, mentions: 120, isPrivate: true, announcement: false },
        ...CHANNELS,
      ],
    }}
    rooms={[
      room({
        name: 'The room with a name far too long for the column it lives in',
        people: [{ id: 'u-long', name: 'somebody-with-a-very-long-username-indeed' }, ...SQUAD.slice(0, 1)],
      }),
    ]}
    user={{ ...USER_IN_CALL, name: 'alexk-with-a-very-long-display-name', line: 'In The room with a name far too long' }}
  />
);

/** Loading: the header and six row skeletons. */
export const Loading = () => <Left view={{ header: { ...HEADER, name: null } }} channels={{ state: loading() }} rooms={[]} />;

/** The channels failed to load: Try again in the island. */
export const LoadError = () => <Left channels={{ state: failed() }} rooms={[]} />;

/** Not a member (403/404). */
export const NotMember = () => <Left view={{ access: 'notMember' }} rooms={[]} user={null} />;

/** In a call, muted: the user card says so (status only; the controls are on the call bar). */
export const UserMuted = () => <Left user={USER_MUTED} />;

/** In a call, deafened. */
export const UserDeafened = () => <Left user={USER_DEAFENED} />;

/** In a call, muted by a moderator. */
export const UserServerMuted = () => <Left user={USER_SERVER_MUTED} />;

/** In a call with push-to-talk on V. */
export const UserPushToTalk = () => <Left user={{ ...USER_IN_CALL, call: { mic: 'pushToTalk', deafened: false, keyLabel: 'V' } }} />;

/** The user card's account menu open: Settings, Your profile, Sign out…. A phone has no user card (the All sheet has these). */
export const AccountMenu = () => <Left user={USER_IDLE} account="menu" />;

/** Sign out… asks first: the question over the screen. Cancel returns to the account menu's button. */
export const SignOutQuestion = () => <Left user={USER_IDLE} account="signOut" />;
