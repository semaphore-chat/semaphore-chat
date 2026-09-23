import type { ReactElement } from 'react';
import MobileAppBar from '../../components/Mobile/MobileAppBar';
import { MobileNavigationProvider } from '../../components/Mobile/Navigation/MobileNavigationContext';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario, primaryCommunity } from '../fixtures/scenarios';

function withNav(children: ReactElement) {
  return defineComponent(bigCommunityScenario, () => <MobileNavigationProvider>{children}</MobileNavigationProvider>, { maxWidth: false });
}

export const Home = withNav(<MobileAppBar title="Semaphore Chat" showDrawerTrigger />);

export const ChannelWithBack = withNav(
  <MobileAppBar
    title="general"
    subtitle={primaryCommunity.name}
    avatarUrl={primaryCommunity.avatar ?? undefined}
    showBack
    showSearch
    showMembers
    showMore
  />,
);
