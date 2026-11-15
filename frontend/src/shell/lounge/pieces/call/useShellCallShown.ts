/**
 * Whether the call-bar slot has anything to show: the template leaves no row (and no gap) without it. In a
 * call or joining one (the call bar), or with a voice notice to show (a failed join, why a call ended).
 */
import { useVoice } from '../../../../contexts/VoiceContext';
import { callSlotContent } from './callSlot';

export function useShellCallShown(): boolean {
  return callSlotContent(useVoice()) !== null;
}
