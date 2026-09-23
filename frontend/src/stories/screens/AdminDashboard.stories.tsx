import { defineScreen } from '../fixtures/screenStory';
import { bigCommunityScenario } from '../fixtures/scenarios';

/** One representative admin page (instance dashboard) — see design doc's "out of scope". */
export const AdminDashboard = defineScreen(bigCommunityScenario, '/admin');

/** Admin community table — community avatars are file ids resolved via AuthenticatedImage. */
export const AdminCommunities = defineScreen(bigCommunityScenario, '/admin/communities');
