/**
 * Turns a scenario + route into a Ladle story component in ~2 lines:
 *
 *   export const ChannelChatBusy = defineScreen(bigCommunityScenario, '/community/community-1/channel/channel-1');
 *
 * `defineScreen` attaches `.msw` (Ladle's built-in MSW addon picks this up
 * automatically — see `.ladle/config.mjs`) so the scenario's fixture data
 * is exactly what the real `<Layout/>` + routes see over the network.
 */
import type { ReactElement, ReactNode } from 'react';
import type { HttpHandler } from 'msw';
import { makeHandlers, type MakeHandlersOptions } from './handlers';
import { SandboxShell } from './SandboxShell';
import type { Scenario } from './types';
import type { VoiceState } from '../../contexts/VoiceContext';

export interface DefineScreenOptions extends MakeHandlersOptions {
  voiceState?: Partial<VoiceState>;
  overlay?: ReactNode;
}

/**
 * Ladle story meta. Ladle reads it statically: set it in the story file as a
 * top-level `MyStory.meta = { ... };` with an object literal (no variables,
 * no `as const`), and it lands in Ladle's meta.json.
 */
export interface StoryMeta {
  /**
   * Viewports the screenshot tools (`scripts/ux-shots.mjs`, the UI review)
   * capture this story at, for a story that only makes sense at some widths —
   * e.g. a 320 px column is a phone layout that tablet and desktop never show.
   * Default: phone, tablet and desktop (only `phone-short` for `*keyboard*` stories).
   */
  viewports?: ('phone' | 'phone-short' | 'tablet' | 'desktop')[];
  [key: string]: unknown;
}

export interface LadleStoryComponent {
  (): ReactElement;
  msw?: HttpHandler[];
  meta?: StoryMeta;
}

export function defineScreen(scenario: Scenario, path: string, options: DefineScreenOptions = {}): LadleStoryComponent {
  const Screen: LadleStoryComponent = () => (
    <SandboxShell path={path} voiceState={options.voiceState} overlay={options.overlay} />
  );
  Screen.msw = makeHandlers(scenario, options);
  return Screen;
}
