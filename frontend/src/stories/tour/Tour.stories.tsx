/**
 * TOUR — the marketing screens the README / docs media are generated from
 * (`frontend/scripts/media/`, see docs/superpowers/specs/2026-09-23-readme-media-design.md).
 *
 * Every story renders the showcase scenario (`fixtures/showcase.ts`) with the
 * showcase theme; the media scripts decide viewport, light/dark variants and
 * what to click or type (`window.__showcase` drives teammates' messages,
 * typing and speaking — see `fixtures/showcaseStory.ts`). Story ids are
 * `tour--<name>`; add a story here, then list it in `scripts/media/shots.mjs`
 * (screenshots) or `scripts/media/record.mjs` (video scenes).
 *
 * All stories show the same moment (Tuesday 3:42 PM), so they must agree:
 * a story that opens a conversation starts with it read (`showcaseWithRead`),
 * and the Voice story adds Alex to the people already in the Lounge
 * (`showcaseWithMeInVoice`) rather than inventing a different crowd.
 */
import { ClickOnMount } from '../fixtures/interactions';
import { findButtonByIconTestId, findButtonByText } from '../fixtures/domQueries';
import { channelVoiceState } from '../fixtures/edge/voice';
import { defineShowcase } from '../fixtures/showcaseStory';
import {
  SHOWCASE_DM_LAUNCH,
  at,
  showcaseChannels,
  showcaseLoungeCrew,
  showcaseMe,
  showcasePaths,
  showcaseStandupCrew,
  showcaseWithMeInVoice,
  showcaseWithRead,
} from '../fixtures/showcase';

const lightTheme = { mode: 'light', accentColor: 'purple', intensity: 'balanced' } as const;

/** #dev on a busy Tuesday: link preview, code, image, reactions, a reply and a thread. */
export const Chat = defineShowcase(showcasePaths.dev);

/** Same, in light mode. */
export const ChatLight = defineShowcase(showcasePaths.dev, { theme: lightTheme });

/**
 * Light mode, connected to Standup: the tour's last scene, after Alex left the
 * Lounge ("On my way to standup" in the phone clip). The voice bar stays with
 * him in #dev and the Standup crew talk in the sidebar.
 */
export const ChatLightStandup = defineShowcase(showcasePaths.dev, {
  scenario: showcaseWithMeInVoice(showcaseChannels.standup.id, undefined, at('15:42')),
  theme: lightTheme,
  voiceState: channelVoiceState(showcaseChannels.standup, { createdAt: at('15:42') }),
  voice: { me: { user: showcaseMe }, remotes: showcaseStandupCrew.map((user) => ({ user })) },
});

/** #dev with the release-planning thread open. */
export const Thread = defineShowcase(showcasePaths.dev, {
  overlay: <ClickOnMount find={() => findButtonByText(/5 replies/i)} timeoutMs={8000} />,
});

/** Community overview (phone: the channel list with unread badges and who's in voice). */
export const Community = defineShowcase(showcasePaths.community);

/** Member list open (desktop shows it anyway; phone/tablet open it from the app bar). */
export const Members = defineShowcase(showcasePaths.general, {
  scenario: showcaseWithRead(showcaseChannels.general.id),
  overlay: <ClickOnMount find={() => findButtonByIconTestId('PeopleIcon')} timeoutMs={8000} />,
});

/**
 * Connected to the "Lounge" voice channel with the people who were already
 * there (Priya and Diego talking): the stage with speaking rings, and the voice bar.
 */
const [priya, diego, chloe] = showcaseLoungeCrew;
export const Voice = defineShowcase(showcasePaths.lounge, {
  scenario: showcaseWithMeInVoice(showcaseChannels.lounge.id),
  voiceState: channelVoiceState(showcaseChannels.lounge, { createdAt: at('15:41') }),
  voice: {
    me: { user: showcaseMe },
    remotes: [
      { user: priya, speaking: true },
      { user: diego, speaking: true },
      { user: chloe },
    ],
  },
});

/** Group DM ("Launch crew") with the DM list. */
const launchCrewRead = showcaseWithRead(SHOWCASE_DM_LAUNCH);
export const Dms = defineShowcase(showcasePaths.dmLaunch, { scenario: launchCrewRead });

/** Group DM in light mode. */
export const DmsLight = defineShowcase(showcasePaths.dmLaunch, { scenario: launchCrewRead, theme: lightTheme });

/** The DM list on its own (phone). */
export const DmList = defineShowcase(showcasePaths.dms);

/** Notifications inbox. */
export const Notifications = defineShowcase(showcasePaths.notifications);

/** Community settings — roles & members management. */
export const CommunitySettings = defineShowcase(showcasePaths.communitySettings);

/** Group DM with a different accent (teal, vibrant). */
export const DmsAccent = defineShowcase(showcasePaths.dmLaunch, {
  scenario: launchCrewRead,
  theme: { mode: 'dark', accentColor: 'teal', intensity: 'vibrant' },
});

const findTab = (label: RegExp) => () =>
  (Array.from(document.querySelectorAll('[role="tab"]')).find((t) => label.test(t.textContent ?? '')) as HTMLElement | undefined) ?? null;

/** Community settings — the Roles tab. */
export const CommunityRoles = defineShowcase(showcasePaths.communitySettings, {
  overlay: <ClickOnMount find={findTab(/^roles$/i)} timeoutMs={8000} />,
});
