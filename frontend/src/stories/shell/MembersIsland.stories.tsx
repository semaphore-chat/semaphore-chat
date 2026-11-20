/**
 * "Who's around" (shell/lounge/pieces/MembersIsland.tsx, design §3.4): Hosts / Around / Away in the
 * members region of the real template, an island at wide and an open Sheet below. Views with the
 * mock-ups' sample data.
 */
import type { JSX } from 'react';
import { MembersIsland, type MembersIslandProps } from '../../shell/lounge/pieces/MembersIsland';
import { CommunityLeftView } from '../../shell/lounge/pieces/community/CommunityLeft';
import type { ModeName } from '../../theme/derive/derivePalette';
import { AROUND, AWAY, CHANNELS, failed, HEADER, HOSTS, loading, manyMembers, noop, NOW, ready } from '../fixtures/loungeCommunity';
import { CommunityPage } from '../fixtures/LoungeCommunityPage';

function Members({ mode, ...props }: Partial<MembersIslandProps> & { mode?: ModeName }): JSX.Element {
  return (
    <CommunityPage
      mode={mode}
      phonePane="centre"
      rightOpen
      left={
        <CommunityLeftView
          access="ok"
          header={HEADER}
          onLeave={noop}
          channels={{ channels: CHANNELS, selectedId: 'ch-general', hrefFor: (id) => `#${id}`, state: ready() }}
          rooms={[]}
        />
      }
      right={
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
          {...props}
        />
      }
    />
  );
}

const sixty = manyMembers(60);
const threeHundred = manyMembers(300);

/** The mock-up: 3 hosts, 6 around, 3 away, "9 around". */
export const Default = () => <Members />;

/** The same, light. */
export const Light = () => <Members mode="light" />;

/** 60 members, every page loaded. */
export const Sixty = () => <Members {...sixty} aroundCount={sixty.hosts.length + sixty.around.length} />;

/** 300 members, three pages loaded of more: no number in the header, Show more at the end. */
export const ThreeHundred = () => <Members {...threeHundred} aroundCount={null} allLoaded={false} />;

/** One group empty: nobody has a role. */
export const NoHosts = () => <Members hosts={[]} aroundCount={6} />;

/** Everyone is away. */
export const OnlyAway = () => <Members hosts={[]} around={[]} aroundCount={0} />;

/** Long names and status text cut with an ellipsis; the role pill stays. */
export const LongStatus = () => (
  <Members
    hosts={[
      {
        ...HOSTS[0],
        name: 'Samira-the-longest-username-on-this-instance',
        statusText: 'keeping the server warm while everyone else sleeps through the patch window',
        role: 'Server administrator',
      },
      ...HOSTS.slice(1),
    ]}
  />
);

/** More pages to load and the next one on its way: Show more is busy, no number yet. */
export const ShowMoreLoading = () => <Members aroundCount={null} allLoaded={false} loadingMore />;

/** Loading: row skeletons. */
export const Loading = () => <Members state={loading()} aroundCount={null} />;

/** No members to show. */
export const Empty = () => <Members hosts={[]} around={[]} away={[]} state={ready(true)} aroundCount={null} />;

/** The members failed to load: Try again. */
export const LoadError = () => <Members state={failed()} aroundCount={null} />;
