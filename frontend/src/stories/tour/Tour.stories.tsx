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
 */
import { ClickOnMount } from '../fixtures/interactions';
import { findButtonByIconTestId, findButtonByText } from '../fixtures/domQueries';
import { channelVoiceState, withChannelPresence } from '../fixtures/edge/voice';
import { defineShowcase } from '../fixtures/showcaseStory';
import { showcaseChannels, showcaseMe, showcasePaths, showcaseScenario, showcaseUsers as U } from '../fixtures/showcase';

const lightTheme = { mode: 'light', accentColor: 'purple', intensity: 'balanced' } as const;

/** #dev on a busy Tuesday: link preview, code, image, reactions, a reply and a thread. */
export const Chat = defineShowcase(showcasePaths.dev);

/** Same, in light mode. */
export const ChatLight = defineShowcase(showcasePaths.dev, { theme: lightTheme });

/** #dev with the release-planning thread open. */
export const Thread = defineShowcase(showcasePaths.dev, {
  overlay: <ClickOnMount find={() => findButtonByText(/5 replies/i)} timeoutMs={8000} />,
});

/** Community overview (phone: the channel list with unread badges and who's in voice). */
export const Community = defineShowcase(showcasePaths.community);

/** Member list open (desktop shows it anyway; phone/tablet open it from the app bar). */
export const Members = defineShowcase(showcasePaths.general, {
  overlay: <ClickOnMount find={() => findButtonByIconTestId('PeopleIcon')} timeoutMs={8000} />,
});

const voiceCrew = {
  me: { user: showcaseMe },
  remotes: [
    { user: U.priya, speaking: true },
    { user: U.marcus, speaking: true },
    { user: U.aiko },
  ],
};

/** Connected to the "Lounge" voice channel: the stage with speaking rings, and the voice bar. */
export const Voice = defineShowcase(showcasePaths.lounge, {
  scenario: withChannelPresence(showcaseScenario, showcaseChannels.lounge.id, [voiceCrew.me, ...voiceCrew.remotes]),
  voiceState: channelVoiceState(showcaseChannels.lounge),
  voice: voiceCrew,
});

/** Group DM ("Launch crew") with the DM list. */
export const Dms = defineShowcase(showcasePaths.dmLaunch);

/** Group DM in light mode. */
export const DmsLight = defineShowcase(showcasePaths.dmLaunch, { theme: lightTheme });

/** The DM list on its own (phone). */
export const DmList = defineShowcase(showcasePaths.dms);

/** Notifications inbox. */
export const Notifications = defineShowcase(showcasePaths.notifications);

/** Community settings — roles & members management. */
export const CommunitySettings = defineShowcase(showcasePaths.communitySettings);


/** Group DM with a different accent (teal, vibrant). */
export const DmsAccent = defineShowcase(showcasePaths.dmLaunch, {
  theme: { mode: 'dark', accentColor: 'teal', intensity: 'vibrant' },
});

const findTab = (label: RegExp) => () =>
  (Array.from(document.querySelectorAll('[role="tab"]')).find((t) => label.test(t.textContent ?? '')) as HTMLElement | undefined) ?? null;

/** Community settings — the Roles tab. */
export const CommunityRoles = defineShowcase(showcasePaths.communitySettings, {
  overlay: <ClickOnMount find={findTab(/^roles$/i)} timeoutMs={8000} />,
});

