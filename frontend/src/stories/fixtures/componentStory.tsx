/**
 * Like `screenStory.tsx`'s `defineScreen`, but for isolated component
 * stories: wraps `children` directly in `SandboxShell` (QueryClient +
 * MemoryRouter + the authenticated provider stack) instead of rendering the
 * real routes, and attaches `.msw` from a scenario.
 */
import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import { makeHandlers, type MakeHandlersOptions } from './handlers';
import { SandboxShell } from './SandboxShell';
import type { Scenario } from './types';
import type { LadleStoryComponent } from './screenStory';
import type { VoiceState } from '../../contexts/VoiceContext';

export interface DefineComponentOptions extends MakeHandlersOptions {
  /** Max width of the padded wrapper box the component renders inside (default 640). `false` disables the wrapper. */
  maxWidth?: number | false;
  voiceState?: Partial<VoiceState>;
  isSocketConnected?: boolean;
}

export function defineComponent(
  scenario: Scenario,
  render: () => ReactNode,
  options: DefineComponentOptions = {},
): LadleStoryComponent {
  const { maxWidth = 640, voiceState, isSocketConnected, ...handlerOptions } = options;
  const Story: LadleStoryComponent = () => (
    <SandboxShell path="/" voiceState={voiceState} isSocketConnected={isSocketConnected}>
      {maxWidth === false ? render() : <Box sx={{ maxWidth, p: 2 }}>{render()}</Box>}
    </SandboxShell>
  );
  Story.msw = makeHandlers(scenario, handlerOptions);
  return Story;
}
