/**
 * TOUR — the marketing screens the README / docs media are generated from
 * (`frontend/scripts/media/`, see docs/superpowers/specs/2026-09-23-readme-media-design.md).
 *
 * Every story renders the showcase scenario (`fixtures/showcase.ts`) with the
 * showcase theme; the media scripts decide viewport, light/dark variants and
 * what to click or type (`window.__showcase` drives other people's messages,
 * typing and speaking — see `fixtures/showcaseStory.ts`). Story ids are
 * `tour--<name>`; add a story here, then list it in `scripts/media/catalog.mjs`
 * (screenshots) or `scripts/media/record.mjs` (video scenes).
 *
 * All stories show the same moment (Tuesday 9:04 PM), so they must agree:
 * a story that opens a conversation starts with it read (`showcaseWithRead`),
 * and the Voice story adds Alex to the people already in Squad Up
 * (`showcaseWithMeInVoice`) rather than inventing a different crowd. Most
 * stories are in Couch Co-op; the Lumen* ones show Alex's work community.
 */
import { ClickOnMount } from '../fixtures/interactions';
import { findButtonByIconTestId, findButtonByText } from '../fixtures/domQueries';
import { channelVoiceState } from '../fixtures/edge/voice';
import { defineShowcase } from '../fixtures/showcaseStory';
import {
  SHOWCASE_DM_LAUNCH,
  SHOWCASE_DM_PRI,
  at,
  showcaseChannels,
  showcaseMe,
  showcasePaths,
  showcaseSquadCrew,
  showcaseWithMeInVoice,
  showcaseWithRead,
} from '../fixtures/showcase';

const lightTheme = { mode: 'light', accentColor: 'purple', intensity: 'balanced' } as const;

/** Couch Co-op #general on a Tuesday evening: link preview, code block, image, GIF, reactions and a thread. */
export const Chat = defineShowcase(showcasePaths.general);

/** Lumen Studio #dev (Alex's work community) in light mode: the same app for a team. */
export const LumenDevLight = defineShowcase(showcasePaths.lumenDev, { theme: lightTheme });

/**
 * Light mode, connected to Squad Up: the tour's last scene. The voice bar
 * stays with Alex in #general while dropbear and pri talk in the sidebar.
 */
export const ChatLightSquad = defineShowcase(showcasePaths.general, {
  scenario: showcaseWithMeInVoice(showcaseChannels.squad.id, undefined, at('21:04')),
  theme: lightTheme,
  voiceState: channelVoiceState(showcaseChannels.squad, { createdAt: at('21:04') }),
  voice: { me: { user: showcaseMe }, remotes: showcaseSquadCrew.map((user) => ({ user })) },
});

/** #general with the "are we doing friday or not" thread open. */
export const Thread = defineShowcase(showcasePaths.general, {
  overlay: <ClickOnMount find={() => findButtonByText(/5 replies/i)} timeoutMs={8000} />,
});

/** Community overview (phone: the channel list with unread badges and who's in voice). */
export const Community = defineShowcase(showcasePaths.community);

/** Member list open (desktop shows it anyway; phone/tablet open it from the app bar). */
export const Members = defineShowcase(showcasePaths.general, {
  overlay: <ClickOnMount find={() => findButtonByIconTestId('PeopleIcon')} timeoutMs={8000} />,
});

/**
 * Connected to the "Squad Up" voice channel with the people who were already
 * there (dropbear and pri, both talking): the stage with speaking rings, and the voice bar.
 */
export const Voice = defineShowcase(showcasePaths.squad, {
  scenario: showcaseWithMeInVoice(showcaseChannels.squad.id),
  voiceState: channelVoiceState(showcaseChannels.squad, { createdAt: at('21:03') }),
  voice: {
    me: { user: showcaseMe },
    remotes: showcaseSquadCrew.map((user) => ({ user, speaking: true })),
  },
});

/** pri's DM (read) with the DM list. */
const priRead = showcaseWithRead(SHOWCASE_DM_PRI);
export const Dms = defineShowcase(showcasePaths.dmPri, { scenario: priRead });

/** pri's DM in light mode. */
export const DmsLight = defineShowcase(showcasePaths.dmPri, { scenario: priRead, theme: lightTheme });

/** The DM list on its own (phone). */
export const DmList = defineShowcase(showcasePaths.dms);

/** Notifications inbox. */
export const Notifications = defineShowcase(showcasePaths.notifications);

/** Lumen Studio's community settings. */
export const CommunitySettings = defineShowcase(showcasePaths.lumenSettings);

/** Lumen Studio's "Launch crew" group DM with a different accent (teal, vibrant). */
export const DmsAccent = defineShowcase(showcasePaths.dmLaunch, {
  scenario: showcaseWithRead(SHOWCASE_DM_LAUNCH),
  theme: { mode: 'dark', accentColor: 'teal', intensity: 'vibrant' },
});

const findTab = (label: RegExp) => () =>
  (Array.from(document.querySelectorAll('[role="tab"]')).find((t) => label.test(t.textContent ?? '')) as HTMLElement | undefined) ?? null;

/** Lumen Studio's community settings — the Roles tab. */
export const CommunityRoles = defineShowcase(showcasePaths.lumenSettings, {
  overlay: <ClickOnMount find={findTab(/^roles$/i)} timeoutMs={8000} />,
});
