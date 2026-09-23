import { EmojiPickerPopover } from '../../components/Message/EmojiPicker';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario, primaryCommunity } from '../fixtures/scenarios';

/**
 * `EmojiPickerPopover` renders a full-width bottom sheet on touch/narrow
 * viewports and an anchored popover otherwise (its own `useResponsive()`
 * check) — the sweep's phone vs. desktop viewports cover both automatically
 * from this one story.
 */
export const Open = defineComponent(
  bigCommunityScenario,
  () => (
    <EmojiPickerPopover
      open
      // Desktop/non-touch renders as a Popover positioned at fixed screen
      // coordinates (mirrors right-click invocation from MessageContextMenu);
      // touch viewports ignore this and always render the full-width sheet.
      anchorPosition={{ top: 160, left: 160 }}
      onClose={() => {}}
      onEmojiSelect={() => {}}
      communityId={primaryCommunity.id}
      onCustomEmojiSelect={() => {}}
    />
  ),
  { maxWidth: false },
);
