/**
 * PLACEHOLDER (PR 3) for `ShellCall` (design §3.5-3.6, PR 7): the call-bar slot, which will hold the
 * CallSurface and the CallBar in a call, the VoiceNoticeBar after a failed join, or nothing.
 */
import type { JSX } from 'react';
import { Placeholder } from '../Placeholder';

export function ShellCall(): JSX.Element | null {
  return <Placeholder name="Call bar" />;
}
