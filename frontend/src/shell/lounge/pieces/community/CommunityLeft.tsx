/**
 * PLACEHOLDER (PR 3) for `CommunityLeft` (design §3.3, PR 6): the left island of a community screen
 * (header, channels, voice rooms, the user's card). The frame gives it the route's ids.
 */
import type { JSX } from 'react';
import { Placeholder } from '../Placeholder';

export interface CommunityLeftProps {
  communityId: string;
  /** The selected channel, when the route names one. */
  channelId: string | null;
}

export function CommunityLeft(_props: CommunityLeftProps): JSX.Element | null {
  return <Placeholder name="Community" />;
}
