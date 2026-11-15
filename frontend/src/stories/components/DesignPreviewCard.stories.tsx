/**
 * The design preview card at /debug/design (pages/debug/PWADebugPage.tsx): the account switch for the
 * new design, this tab's `?design=` override with Clear, and the link to the marker screen.
 */
import { useState } from 'react';
import { DesignPreviewCard } from '../../pages/debug/PWADebugPage';
import { clearDesignPreview, setDesignPreview, type DesignPreview } from '../../shell/designPreview';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario } from '../fixtures/scenarios';

/** Sets this tab's override before the card renders (and clears it when the story has none). */
function WithOverride({ preview }: { preview: DesignPreview | null }) {
  useState(() => (preview === null ? clearDesignPreview() : setDesignPreview(preview)));
  return <DesignPreviewCard />;
}

/** The tab follows the account: no Clear button. */
export const FollowsAccount = defineComponent(bigCommunityScenario, () => <WithOverride preview={null} />);

/** A `?design=lounge` link was opened in this tab: the override and Clear show. */
export const TabOverride = defineComponent(bigCommunityScenario, () => <WithOverride preview="lounge" />);
