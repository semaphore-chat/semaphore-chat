/**
 * The composer stack: reply banner (body font, muted, one line), five pending
 * attachments (neutral chips, not accent) and a multi-line draft that is
 * capped at 40% of the chat column and then scrolls. Light and dark; phone
 * and tablet are captured as well, to check the cap doesn't break them.
 */
import React from 'react';
import { edgeScreen } from '../../fixtures/edge/states';
import type { ThemeSettings } from '../../../theme/constants';
import { bigCommunityScenario as s, primaryCommunity, generalChannel } from '../../fixtures/scenarios';
import {
  useDriver,
  findMessageRow,
  openMessageActions,
  clickActionItem,
  composerTextarea,
  attachFiles,
  typeInto,
  wait,
  mediaSettled,
  FIVE_FILES,
  FOUR_LINE_DRAFT,
} from '../../fixtures/edge/chat';

const light: ThemeSettings = { mode: 'light', accentColor: 'teal', intensity: 'minimal' };
const dark: ThemeSettings = { mode: 'dark', accentColor: 'teal', intensity: 'minimal' };
const chatPath = `/community/${primaryCommunity.id}/channel/${generalChannel.id}`;

// Twenty short lines: far taller than 40% of any viewport, so the cap shows.
const TALL_DRAFT = Array.from({ length: 20 }, (_, i) => `draft line ${i + 1}`).join('\n');

function ComposerStack({ draft }: { draft: string }) {
  useDriver([
    () => document.querySelectorAll('[data-row-focus-target="true"]').length > 3,
    mediaSettled(),
    () => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-row-focus-target="true"]'));
      const row = rows[rows.length - 2];
      if (!row) return false;
      openMessageActions(findMessageRow((row.textContent ?? '').slice(0, 12)) ?? row);
    },
    wait(700),
    () => clickActionItem(/^Reply$/),
    () => !!composerTextarea(),
    () => attachFiles(FIVE_FILES),
    wait(300),
    () => typeInto(composerTextarea()!, draft),
    mediaSettled(),
  ]);
  return null;
}

const Four: React.FC = () => <ComposerStack draft={FOUR_LINE_DRAFT} />;
const Tall: React.FC = () => <ComposerStack draft={TALL_DRAFT} />;

/** Reply + 5 attachments + 4-line draft; dark. */
export const ReplyFiveFilesFourLinesDark = edgeScreen(s, chatPath, { theme: dark, overlay: <Four /> });

/** Reply + 5 attachments + 4-line draft; light. */
export const ReplyFiveFilesFourLinesLight = edgeScreen(s, chatPath, { theme: light, overlay: <Four /> });

/** A 20-line draft: the input stops at 40% of the chat column and scrolls; dark. */
export const TallDraftCappedDark = edgeScreen(s, chatPath, { theme: dark, overlay: <Tall /> });

/** A 20-line draft; light. */
export const TallDraftCappedLight = edgeScreen(s, chatPath, { theme: light, overlay: <Tall /> });
