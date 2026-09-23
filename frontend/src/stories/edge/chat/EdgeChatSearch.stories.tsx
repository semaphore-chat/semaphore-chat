/**
 * Message search, driven through the real UI: tap the chat's Search button,
 * then type. On phones this opens the full-screen `MobileSearchScreen`
 * (/community/:cid/channel/:chid/search); tablet shows it in the content pane;
 * desktop opens the anchored `MessageSearch` popover.
 */
import React from 'react';
import { defineScreen, type LadleStoryComponent } from '../../fixtures/screenStory';
import {
  edgeChatScenario,
  chatHandlers,
  channelPath,
  wallOfTextChannel,
  useDriver,
  clickButtonByText,
  wait,
  type DriverStep,
} from '../../fixtures/edge/chat';

const Drive: React.FC<{ steps: DriverStep[] }> = ({ steps }) => {
  useDriver(steps);
  return null;
};

/** Phone/tablet app bar button is "Search"; the desktop header's is "Search messages". */
function openSearch(): boolean {
  const el =
    document.querySelector<HTMLElement>('button[aria-label="Search"]') ??
    document.querySelector<HTMLElement>('button[aria-label="Search messages"]');
  if (!el) return false;
  el.click();
  return true;
}

function searchInput(): HTMLInputElement | null {
  return (
    document.querySelector<HTMLInputElement>('input[aria-label="Search messages"]') ??
    document.querySelector<HTMLInputElement>('input[placeholder="Search messages..."]')
  );
}

function typeSearch(value: string): boolean {
  const el = searchInput();
  if (!el) return false;
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function story(steps: DriverStep[]): LadleStoryComponent {
  return defineScreen(edgeChatScenario, channelPath(wallOfTextChannel), {
    extraHandlers: chatHandlers(),
    overlay: <Drive steps={steps} />,
  });
}

/** "queue" across all channels: several hits with #channel chips, authors, times and 2-line previews. */
export const Results = story([
  openSearch,
  () => !!searchInput(),
  wait(300),
  () => clickButtonByText(/^All Channels$/),
  () => typeSearch('queue'),
]);

/** A query with no matches in this channel: the empty state suggests searching all channels. */
export const NoResults = story([
  openSearch,
  () => !!searchInput(),
  wait(300),
  () => typeSearch('kubernetes'),
]);
