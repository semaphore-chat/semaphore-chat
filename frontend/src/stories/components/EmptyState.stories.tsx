import EmptyState from '../../components/Common/EmptyState';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario } from '../fixtures/scenarios';

export const Messages = defineComponent(bigCommunityScenario, () => <EmptyState variant="messages" />);
export const DirectMessages = defineComponent(bigCommunityScenario, () => <EmptyState variant="dm" />);
export const Notifications = defineComponent(bigCommunityScenario, () => <EmptyState variant="notifications" />);
export const SearchResults = defineComponent(bigCommunityScenario, () => <EmptyState variant="search" />);
