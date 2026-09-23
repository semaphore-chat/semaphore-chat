/**
 * What the media pipeline produces: every screenshot (story + viewport) and
 * video, with the caption and alt text used by the README and the docs Tour
 * page. `shots.mjs` writes this out as `.media-out/manifest.json`.
 *
 * `section` groups the docs gallery (docs-site/docs/tour.md); `readme: true`
 * marks the six README grid shots (all desktop, so the grid lines up).
 */
export const SECTIONS = [
  'Chat',
  'Threads & replies',
  'Voice & video',
  'DMs',
  'Communities & roles',
  'Mobile & PWA',
  'Themes',
];

export const SHOTS = [
  {
    name: 'chat-desktop', story: 'tour--chat', viewport: 'desktop', section: 'Chat', readme: true,
    caption: 'Text channels with link previews, code blocks, images and reactions',
    alt: 'The #dev channel of the Lumen Studio community on desktop: a pull-request link preview, a code block, an image of a design mock with emoji reactions, and the member list with online status.',
  },
  {
    name: 'thread-desktop', story: 'tour--thread', viewport: 'desktop', section: 'Threads & replies', readme: true,
    caption: 'Threads keep side conversations out of the main channel',
    alt: 'A message thread about the release plan open beside the #dev channel, with five replies and reactions.',
  },
  {
    name: 'voice-desktop', story: 'tour--voice', viewport: 'desktop', section: 'Voice & video', readme: true,
    caption: 'Drop-in voice channels, with speaking indicators and a persistent voice bar',
    alt: 'The Lounge voice channel on desktop: a stage of four participant tiles, two of them outlined because they are speaking, and the voice controls at the bottom.',
  },
  {
    name: 'dms-desktop', story: 'tour--dms', viewport: 'desktop', section: 'DMs', readme: true,
    caption: 'Direct messages and group DMs, with unread badges',
    alt: 'The "Launch crew" group direct message on desktop, with the conversation list showing unread counts.',
  },
  {
    name: 'community-settings-desktop', story: 'tour--community-settings', viewport: 'desktop', section: 'Communities & roles',
    caption: 'Community settings, members and roles',
    alt: 'The Lumen Studio community settings page with its banner, name and description.',
  },
  {
    name: 'community-roles-desktop', story: 'tour--community-roles', viewport: 'desktop', section: 'Communities & roles', readme: true,
    caption: 'Roles with granular permissions',
    alt: 'The Roles tab of the Lumen Studio community settings, listing Owner, Moderator, Release Manager, Designer and Member roles with their permissions.',
  },
  {
    name: 'chat-light-desktop', story: 'tour--chat-light', viewport: 'desktop', section: 'Themes', readme: true,
    caption: 'Light and dark themes with twelve accent colours',
    alt: 'The #dev channel in the light theme with a violet accent.',
  },
  {
    name: 'notifications-desktop', story: 'tour--notifications', viewport: 'desktop', section: 'Chat',
    caption: 'Mentions, replies and DMs in one notifications inbox',
    alt: 'The notifications page listing mentions, a thread reply and a direct message.',
  },
  {
    name: 'dms-light-desktop', story: 'tour--dms-light', viewport: 'desktop', section: 'Themes',
    caption: 'Group DMs in the light theme',
    alt: 'The "Launch crew" group direct message in the light theme.',
  },
  {
    name: 'dms-accent-desktop', story: 'tour--dms-accent', viewport: 'desktop', section: 'Themes',
    caption: 'Every accent colour works in both modes',
    alt: 'The "Launch crew" group direct message in the dark theme with a teal accent and vibrant intensity.',
  },
  {
    name: 'chat-phone', story: 'tour--chat', viewport: 'phone', section: 'Mobile & PWA',
    caption: 'The same chat, built for phones',
    alt: 'The #dev channel on a phone, with the message composer at the bottom.',
  },
  {
    name: 'community-phone', story: 'tour--community', viewport: 'phone', section: 'Mobile & PWA',
    caption: 'Channel list with unread badges and who is in voice',
    alt: 'The Lumen Studio channel list on a phone, with unread badges and the people currently in the Standup voice channel.',
  },
  {
    name: 'thread-phone', story: 'tour--thread', viewport: 'phone', section: 'Threads & replies',
    caption: 'Threads open full screen on phones',
    alt: 'The release-plan thread open full screen on a phone.',
  },
  {
    name: 'voice-phone', story: 'tour--voice', viewport: 'phone', section: 'Voice & video',
    caption: 'Voice on the go',
    alt: 'The Lounge voice channel on a phone, with participant tiles and compact voice controls.',
  },
  {
    name: 'dm-list-phone', story: 'tour--dm-list', viewport: 'phone', section: 'DMs',
    caption: 'Your conversations at a glance',
    alt: 'The direct message list on a phone, with unread badges and message previews.',
  },
  {
    name: 'members-phone', story: 'tour--members', viewport: 'phone', section: 'Communities & roles',
    caption: 'Members grouped by role and online status',
    alt: 'The member list on a phone, grouped into owner, moderators, online and offline members.',
  },
];

export const VIDEOS = [
  {
    name: 'hero', file: 'video/hero.webp', fallback: 'video/hero.gif', section: 'Tour',
    caption: 'Semaphore Chat in 15 seconds',
    alt: 'A short looping clip: a message is typed and sent in the #dev channel, a teammate replies and reacts, a thread opens, and then the Lounge voice channel shows people talking.',
  },
  {
    name: 'tour', file: 'video/tour.mp4', poster: 'video/tour-poster.webp', section: 'Tour',
    caption: 'A 40-second tour of Semaphore Chat',
    alt: 'A guided tour: chatting and reacting in a channel, a thread, group DMs, a voice channel with people speaking, and the app on a phone.',
  },
];
