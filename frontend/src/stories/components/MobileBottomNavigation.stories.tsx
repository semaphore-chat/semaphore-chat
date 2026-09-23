import { MobileBottomNavigation } from '../../components/Mobile/Navigation/MobileBottomNavigation';
import { MobileNavigationProvider } from '../../components/Mobile/Navigation/MobileNavigationContext';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario } from '../fixtures/scenarios';

export const Default = defineComponent(
  bigCommunityScenario,
  () => (
    <MobileNavigationProvider>
      <MobileBottomNavigation />
    </MobileNavigationProvider>
  ),
  { maxWidth: 420 },
);
