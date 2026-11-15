/**
 * PLACEHOLDER (PR 3) for `MembersIsland` and its connected wrapper (design §3.4, PR 6): "Who's
 * around" in the right region (an island at wide, a Sheet below).
 */
import type { JSX } from 'react';
import { Placeholder } from './Placeholder';

export interface MembersIslandConnectedProps {
  communityId: string;
}

export function MembersIslandConnected(_props: MembersIslandConnectedProps): JSX.Element | null {
  return <Placeholder name="Members" />;
}
