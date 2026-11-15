/**
 * The community left island (shell/lounge/pieces/community, design §3.3) in the real ThreeIslands
 * template: the header and its menu, the channels, the voice rooms and the user's card. Views with the
 * mock-ups' sample data; the connected island is in the `lounge-frame--three-islands-*` stories.
 * A phone shows the left pane (a community home) and no user card.
 */
import type { JSX } from 'react';
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
  USER_IN_CALL,
  useUserCardShown,
} from '../fixtures/loungeCommunity';
import { CommunityPage } from '../fixtures/LoungeCommunityPage';

interface LeftOptions {
  mode?: ModeName;
  view?: Partial<Omit<CommunityLeftViewProps, 'rooms' | 'userCard'>>;
  channels?: Partial<CommunityLeftViewProps['channels']>;
  rooms?: VoiceRoomCardProps[];
  user?: typeof USER_IN_CALL | null;
  members?: boolean;
}

function Left({ mode, view, channels, rooms = [SQUAD_HERE, AFK], user = USER_IN_CALL, members = false }: LeftOptions): JSX.Element {
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
          userCard={userShown && user ? <UserCard {...user} /> : null}
        />
      }
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

/** Five channels: two private, unread without a mention (bold) beside mentions, lfg selected. */
export const FiveChannels = () => <Left channels={{ channels: FIVE_CHANNELS, selectedId: 'ch-lfg' }} />;

/** No channels yet (and no voice rooms). */
export const ZeroChannels = () => <Left channels={{ channels: [], state: ready(true) }} rooms={[]} />;

/** 200 channels: the island scrolls, the user card stays at its foot. */
export const TwoHundredChannels = () => <Left channels={{ channels: manyChannels(200), selectedId: 'ch-3' }} />;

/** Long names everywhere: they cut with an ellipsis, nothing scrolls sideways. */
export const LongNames = () => (
  <Left
    view={{ header: { ...HEADER, name: 'The Couch Co-op and Friends of the Couch International Society' } }}
    channels={{
      channels: [
        { id: 'ch-long', name: LONG, unread: true, mentions: 120, isPrivate: true },
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

/** Push-to-talk: the mute button cannot be tapped (it says why), deafened. */
export const PushToTalkDeafened = () => (
  <Left
    user={{
      ...USER_IN_CALL,
      call: { mic: { muted: true, disabled: true, title: 'Hold V to talk' }, deafened: true, onMute: noop, onDeafen: noop },
    }}
  />
);
