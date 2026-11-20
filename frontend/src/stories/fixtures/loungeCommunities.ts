/**
 * Sample communities for the new shell's dock and "All communities" sheet, from the mock-ups
 * (`Couch Co-op`, `Lumen Studio`, `Friday LAN`; the user is alexk on moss.social), and a fixed load
 * state for the sheet's `useLoad`. Used by the stories and the piece tests.
 */
import { useLoadState, type LoadController } from '../../kit';
import type { DockCommunity } from '../../shell/lounge/pieces/ShellDock';
import type { SheetCommunity } from '../../shell/lounge/pieces/AllCommunitiesSheet';

const NAMES = [
  'Couch Co-op',
  'Trailheads',
  'Lumen Studio',
  'Friday LAN',
  'Wavelength',
  'Retro Night',
  'Pixel Pushers',
  'Book Nook',
  'Synth Garden',
  'Design Guild',
  'Night Owls',
  'Tabletop Tuesdays',
];

export const LONG_NAME = 'The Late-Night Speedrunners, Tinkerers and Occasional Bakers Society';

export interface SampleCommunity extends SheetCommunity, DockCommunity {}

function sample(index: number): SampleCommunity {
  const base = NAMES[index % NAMES.length];
  const round = Math.floor(index / NAMES.length);
  const name = round === 0 ? base : `${base} ${round + 1}`;
  return { id: `c-${index + 1}`, name, mentions: 0, newMessages: false, inYourCall: false };
}

/** `count` communities: c-1 (Couch Co-op) ... ; quiet unless `states` says otherwise. */
export function sampleCommunities(
  count: number,
  states: Record<number, Partial<SampleCommunity>> = {},
): SampleCommunity[] {
  return Array.from({ length: count }, (_, index) => ({ ...sample(index), ...states[index] }));
}

/** The mock-ups' mix: Couch Co-op (your call), Lumen Studio 2 mentions, Friday LAN new messages, Wavelength both. */
export const MOCKUP_STATES: Record<number, Partial<SampleCommunity>> = {
  0: { inYourCall: true },
  2: { mentions: 2 },
  3: { newMessages: true },
  4: { mentions: 3, newMessages: true },
};

export type FixedLoad = 'ready' | 'empty' | 'loading' | 'error';

const forever = new Promise<never>(() => undefined);

/** A `useLoad` hook for the sheet's view that settles one way. */
export function fixedLoad(outcome: FixedLoad): () => LoadController {
  return function useFixedLoad(): LoadController {
    return useLoadState<number>({
      notifyId: 'all-communities-story',
      resetKey: outcome,
      load: () =>
        outcome === 'loading'
          ? forever
          : outcome === 'error'
            ? Promise.reject(new Error('Request failed'))
            : Promise.resolve(outcome === 'empty' ? 0 : 1),
      isEmpty: (count) => count === 0,
    }).state;
  };
}
