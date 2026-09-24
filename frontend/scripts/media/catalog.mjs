/**
 * What the media pipeline produces: every screenshot (story + viewport) and
 * video, with the caption and alt text used by the README and the docs Tour
 * page. `shots.mjs` writes this out as `.media-out/manifest.json`.
 *
 * `section` groups the docs gallery (docs-site/docs/tour.md); `readme: true`
 * marks the six README grid shots (all desktop, so the grid lines up);
 * `prepare` names a page tweak in shots.mjs (`PREPARE`) run before the shot.
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
    caption: 'Text channels with images, GIFs, reactions and mentions',
    alt: 'The #general channel of the Couch Co-op community on desktop: a mention, a game screenshot with emoji reactions, an animated GIF, and the member list grouped by role with online status.',
  },
  {
    name: 'thread-desktop', story: 'tour--thread', viewport: 'desktop', section: 'Threads & replies', readme: true,
    caption: 'Threads keep side conversations out of the main channel',
    alt: 'A thread about Friday\'s game night open beside the #general channel, with five replies.',
  },
  {
    name: 'voice-desktop', story: 'tour--voice', viewport: 'desktop', section: 'Voice & video', readme: true,
    caption: 'Drop-in voice channels, with speaking indicators and a persistent voice bar',
    alt: 'The Squad Up voice channel on desktop: a stage of three participant tiles, two of them outlined because they are speaking, and the voice controls at the bottom.',
  },
  {
    name: 'dms-desktop', story: 'tour--dms', viewport: 'desktop', section: 'DMs', readme: true,
    caption: 'Direct messages and group DMs, with unread badges',
    alt: 'A direct message conversation on desktop, with the conversation list showing unread counts.',
  },
  {
    name: 'community-settings-desktop', story: 'tour--community-settings', viewport: 'desktop', section: 'Communities & roles',
    caption: 'Community settings, members and roles',
    alt: 'The community settings page of Lumen Studio, a product team\'s community, with its banner, name and description.',
  },
  {
    name: 'community-roles-desktop', story: 'tour--community-roles', viewport: 'desktop', section: 'Communities & roles', readme: true,
    caption: 'Roles with granular permissions',
    alt: 'The Roles tab of the Lumen Studio community settings, listing the default Community Admin, Moderator and Member roles and the custom Release Manager and Designer roles, with their permissions.',
  },
  {
    name: 'chat-light-desktop', story: 'tour--lumen-dev-light', viewport: 'desktop', section: 'Themes', readme: true,
    caption: 'Light and dark themes with twelve accent colours',
    alt: 'The #dev channel of Lumen Studio, a product team\'s community, in the light theme with a violet accent: a pull-request link preview, a code block and a five-reply thread.',
  },
  {
    name: 'notifications-desktop', story: 'tour--notifications', viewport: 'desktop', section: 'Chat',
    caption: 'Mentions, replies and DMs in one notifications inbox',
    alt: 'The notifications page listing direct messages, a mention and a thread reply.',
  },
  {
    name: 'dms-light-desktop', story: 'tour--dms-light', viewport: 'desktop', section: 'Themes',
    caption: 'Direct messages in the light theme',
    alt: 'A direct message conversation in the light theme.',
  },
  {
    name: 'dms-accent-desktop', story: 'tour--dms-accent', viewport: 'desktop', section: 'Themes',
    caption: 'Every accent colour works in both modes',
    alt: 'The "Launch crew" group direct message in the dark theme with a teal accent and vibrant intensity.',
  },
  {
    name: 'chat-phone', story: 'tour--chat', viewport: 'phone', section: 'Mobile & PWA',
    caption: 'The same chat, built for phones',
    alt: 'The #general channel on a phone: a message with a thread, a game screenshot with reactions, an animated GIF and the message composer.',
  },
  {
    name: 'community-phone', story: 'tour--community', viewport: 'phone', section: 'Mobile & PWA',
    caption: 'Channel list with unread channels and who is in voice',
    alt: 'The Couch Co-op channel list on a phone, with unread channels marked and the people currently in the Squad Up and AFK voice channels.',
  },
  {
    name: 'thread-phone', story: 'tour--thread', viewport: 'phone', section: 'Threads & replies', prepare: 'threadFromTop',
    caption: 'Threads open full screen on phones',
    alt: 'The Friday thread open full screen on a phone, with five replies.',
  },
  {
    name: 'voice-phone', story: 'tour--voice', viewport: 'phone', section: 'Voice & video',
    caption: 'Voice on the go',
    alt: 'The Squad Up voice channel on a phone, with participant tiles and compact voice controls.',
  },
  {
    name: 'dm-list-phone', story: 'tour--dm-list', viewport: 'phone', section: 'DMs',
    caption: 'Your conversations at a glance',
    alt: 'The direct message list on a phone, with unread badges and message previews.',
  },
  {
    name: 'members-phone', story: 'tour--members', viewport: 'phone', section: 'Communities & roles',
    caption: 'Members grouped by role and online status',
    alt: 'The Couch Co-op member list on a phone, grouped by role (Community Admin, mods) and online status.',
  },
];

export const VIDEOS = [
  {
    name: 'hero', file: 'video/hero.webp', fallback: 'video/hero.gif', section: 'Tour',
    caption: 'Semaphore Chat in 15 seconds',
    alt: 'A short looping clip: a message is typed and sent in a community\'s #general channel, a reaction is added, a thread opens, and then the Squad Up voice channel shows two people talking.',
  },
  {
    name: 'tour', file: 'video/tour.mp4', poster: 'video/tour-poster.webp', section: 'Tour',
    caption: 'A 40-second tour of Semaphore Chat',
    alt: 'A guided tour: sending a message and adding a reaction in a channel, opening a thread, replying to a direct message, sending a GIF from the GIF picker on a phone, a voice channel with people speaking, and the light theme with the voice bar.',
  },
];
