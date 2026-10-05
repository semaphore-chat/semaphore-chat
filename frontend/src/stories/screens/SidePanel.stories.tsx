/**
 * The docked side panel (`ChannelMessageContainer` + `DockedSidePanel`).
 *
 * On a wide desktop window (>= 1200px, web or Electron) threads, pinned
 * messages and search open in a non-modal 400px panel to the right of the
 * messages, in place of the member list; the channel stays readable and
 * replyable. Below that (the 820px Electron window, the touch tablet and
 * phone layouts) they keep the drawers / popover / full-screen layer, so the
 * phone and tablet shots of these stories show the unchanged mobile UI.
 */
import React from 'react';
import { defineScreen } from '../fixtures/screenStory';
import { asElectron } from '../fixtures/electron';
import { ClickOnMount } from '../fixtures/interactions';
import { findButtonByIconTestId, findMenuItemByText } from '../fixtures/domQueries';
import { bigCommunityScenario, primaryCommunity, generalChannel } from '../fixtures/scenarios';
import {
  edgeChatScenario,
  chatHandlers,
  channelPath,
  threadsChannel,
  useDriver,
  clickButtonByText,
  type DriverStep,
} from '../fixtures/edge/chat';
import type { Scenario } from '../fixtures/types';

const generalPath = `/community/${primaryCommunity.id}/channel/${generalChannel.id}`;

const Drive: React.FC<{ steps: DriverStep[] }> = ({ steps }) => {
  useDriver(steps);
  return null;
};

/** Desktop: the header's pin button. Phone/tablet: the app bar's "more" menu item. */
const OpenPins: React.FC = () => (
  <>
    <ClickOnMount find={() => findButtonByIconTestId('PushPinIcon') ?? findButtonByIconTestId('MoreVertIcon')} />
    <ClickOnMount find={() => findMenuItemByText(/Pinned Messages/i)} />
  </>
);

/** Type into a controlled <input> the way a user would (native setter + input event). */
function typeIntoInput(input: HTMLInputElement, value: string): void {
  input.focus();
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const searchInput = () => document.querySelector<HTMLInputElement>('input[placeholder="Search messages..."]');

/**
 * Desktop: the header's search button, then a query. The phone/tablet layouts
 * have a full search screen with its own stories, so there this shows the
 * channel unchanged.
 */
const OpenSearch: React.FC<{ query: string }> = ({ query }) => {
  useDriver([
    () => {
      const button = document.querySelector<HTMLElement>('button[aria-label="Search messages"]') ??
        findButtonByIconTestId('SearchIcon');
      if (!button || !document.querySelector('[role="list"][aria-label="Messages"]')) return false;
      button.click();
      return true;
    },
    () => {
      const input = searchInput();
      if (!input) return false;
      typeIntoInput(input, query);
      return true;
    },
  ]);
  return null;
};

/** #general with seven pinned messages instead of one. */
const manyPinsScenario: Scenario = (() => {
  const messages = bigCommunityScenario.messagesByChannel[generalChannel.id] ?? [];
  const [template] = bigCommunityScenario.pinnedByChannel[generalChannel.id] ?? [];
  if (!template) return bigCommunityScenario;
  const pins = messages.slice(2, 9).map((m, i) => ({
    ...template,
    id: m.id,
    authorId: m.authorId,
    spans: m.spans as never,
    sentAt: m.sentAt,
    pinnedAt: new Date(Date.parse(template.pinnedAt ?? m.sentAt) - i * 3_600_000).toISOString(),
  }));
  return {
    ...bigCommunityScenario,
    pinnedByChannel: { ...bigCommunityScenario.pinnedByChannel, [generalChannel.id]: [template, ...pins] },
  };
})();

/** #general with nothing pinned. */
const noPinsScenario: Scenario = {
  ...bigCommunityScenario,
  pinnedByChannel: { ...bigCommunityScenario.pinnedByChannel, [generalChannel.id]: [] },
};

const openLongThread = <Drive steps={[() => clickButtonByText(/^8 replies/)]} />;

/** A thread of 8 long replies (walls of text, wide code) docked beside the channel; the member list makes way. */
export const ThreadDockedLong = defineScreen(edgeChatScenario, channelPath(threadsChannel), {
  extraHandlers: chatHandlers(),
  overlay: openLongThread,
});

/** The 200-reply thread docked: the panel scrolls on its own, the channel keeps its scroll position. */
export const ThreadDockedManyReplies = defineScreen(edgeChatScenario, channelPath(threadsChannel), {
  extraHandlers: chatHandlers(),
  overlay: <Drive steps={[() => clickButtonByText(/^200 replies/)]} />,
});

/** The pinned list docked, with eight pins. */
export const PinsDocked = defineScreen(manyPinsScenario, generalPath, { overlay: <OpenPins /> });

/** The pinned list docked for a channel with nothing pinned (its empty state). */
export const PinsDockedEmpty = defineScreen(noPinsScenario, generalPath, { overlay: <OpenPins /> });

/** Search docked with results for "the" in this channel; the results fill the panel's height. */
export const SearchDocked = defineScreen(bigCommunityScenario, generalPath, {
  overlay: <OpenSearch query="the" />,
});

/** Search docked with no matches. */
export const SearchDockedNoResults = defineScreen(bigCommunityScenario, generalPath, {
  overlay: <OpenSearch query="zzzz-nothing-matches" />,
});

/**
 * Electron at its 820px minimum: below the docking breakpoint, so the thread
 * opens in the side drawer over the channel, as before.
 */
export const ElectronNarrowThreadDrawer = asElectron(
  defineScreen(edgeChatScenario, channelPath(threadsChannel), {
    extraHandlers: chatHandlers(),
    overlay: openLongThread,
  }),
);
ElectronNarrowThreadDrawer.meta = { viewports: ['tablet'] };

/** Electron at 820px: pins in the side drawer. */
export const ElectronNarrowPinsDrawer = asElectron(defineScreen(manyPinsScenario, generalPath, { overlay: <OpenPins /> }));
ElectronNarrowPinsDrawer.meta = { viewports: ['tablet'] };

/** A wide Electron window docks the thread like the web app. */
export const ElectronWideThreadDocked = asElectron(
  defineScreen(edgeChatScenario, channelPath(threadsChannel), {
    extraHandlers: chatHandlers(),
    overlay: openLongThread,
  }),
);
ElectronWideThreadDocked.meta = { viewports: ['desktop'] };
