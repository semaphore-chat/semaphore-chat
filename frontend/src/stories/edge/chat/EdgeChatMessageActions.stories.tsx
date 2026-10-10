/**
 * Message actions on desktop: the hover toolbar and the right-click menu
 * (quick-reaction row, Reply / Thread / React / Edit / Pin / Copy, then Delete
 * after a divider), in light and dark. Desktop-only: touch layouts use the
 * action sheet (`MessageActionsSheet` stories).
 */
import React, { useEffect } from 'react';
import GlobalStyles from '@mui/material/GlobalStyles';
import { edgeScreen } from '../../fixtures/edge/states';
import type { ThemeSettings } from '../../../theme/constants';
import { bigCommunityScenario as s, primaryCommunity, generalChannel } from '../../fixtures/scenarios';
import { useDriver, findMessageRow, openMessageActions, wait, mediaSettled } from '../../fixtures/edge/chat';

const light: ThemeSettings = { mode: 'light', accentColor: 'teal', intensity: 'minimal' };
const dark: ThemeSettings = { mode: 'dark', accentColor: 'teal', intensity: 'minimal' };
const chatPath = `/community/${primaryCommunity.id}/channel/${generalChannel.id}`;

/**
 * The hover toolbar is CSS `:hover`, which a screenshot can't trigger: mark one
 * row (another user's, so the toolbar has its usual buttons) as hovered.
 */
const HoveredToolbar: React.FC = () => {
  const mark = () => {
    document.querySelectorAll('[data-story-hover]').forEach((el) => el.removeAttribute('data-story-hover'));
    // `last`: the thread parent above also quotes this text in its reply preview.
    const row = findMessageRow('need a second pair of eyes', { last: true });
    row?.setAttribute('data-story-hover', 'true');
    return !!row;
  };
  // The driver holds the screenshot until the row is marked and has painted.
  useDriver([() => mark(), mediaSettled(), wait(500), () => mark(), wait(300)]);
  // The virtual list may re-create a row's element, so keep marking it.
  useEffect(() => {
    const id = setInterval(mark, 150);
    return () => clearInterval(id);
  }, []);
  return <GlobalStyles styles={{ '[data-story-hover] .message-tools': { opacity: '1 !important', transition: 'none !important' } }} />;
};

/** Right-click the last message once the list has settled, as a user would. */
const OpenContextMenu: React.FC = () => {
  useDriver([
    () => document.querySelectorAll('[data-row-focus-target="true"]').length > 3,
    mediaSettled(),
    () => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-row-focus-target="true"]'));
      const row = rows[rows.length - 3];
      if (!row) return false;
      openMessageActions(findMessageRow((row.textContent ?? '').slice(0, 12)) ?? row);
    },
    wait(400),
  ]);
  return null;
};

/** The floating toolbar (react, quote, thread, pin, edit, delete) shown as on hover; dark. */
export const HoverToolbarDark = edgeScreen(s, chatPath, { theme: dark, overlay: <HoveredToolbar /> });
HoverToolbarDark.meta = { viewports: ['desktop'] };

/** The floating toolbar shown as on hover; light. */
export const HoverToolbarLight = edgeScreen(s, chatPath, { theme: light, overlay: <HoveredToolbar /> });
HoverToolbarLight.meta = { viewports: ['desktop'] };

/** Right-click menu open on a message: reactions row, ordered actions, Delete last in red; dark. */
export const ContextMenuDark = edgeScreen(s, chatPath, { theme: dark, overlay: <OpenContextMenu /> });
ContextMenuDark.meta = { viewports: ['desktop'] };

/** Right-click menu open on a message; light. */
export const ContextMenuLight = edgeScreen(s, chatPath, { theme: light, overlay: <OpenContextMenu /> });
ContextMenuLight.meta = { viewports: ['desktop'] };
