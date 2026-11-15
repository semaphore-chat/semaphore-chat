/**
 * The voice notice in the call slot when there is no call (shell/lounge/pieces/call/VoiceNoticeBar.tsx):
 * a failed join with Retry, why a call ended, a join to a room that is gone (no Retry).
 */
import { VoiceNoticeBar } from '../../shell/lounge/pieces/call/VoiceNoticeBar';
import type { VoiceNotice } from '../../data/voiceNotice';
import type { ModeName } from '../../theme/derive/derivePalette';
import { CallSlotFrame } from '../fixtures/CallSlotFrame';
import { ENDED_NOTICE, NOT_FOUND_NOTICE, fakeVoiceNotice } from '../fixtures/callBarFixtures';

function Notice({ mode = 'dark', ...notice }: Partial<VoiceNotice> & { mode?: ModeName }) {
  return <CallSlotFrame mode={mode}>{() => <VoiceNoticeBar notice={fakeVoiceNotice(notice)} />}</CallSlotFrame>;
}

/** A failed join that Retry can help. */
export const FailedJoin = () => <Notice />;
/** The same, light. */
export const FailedJoinLight = () => <Notice mode="light" />;
/** Why the call ended (another device), no Retry. */
export const CallEnded = () => <Notice {...ENDED_NOTICE} />;
/** Why the call ended, light. */
export const CallEndedLight = () => <Notice mode="light" {...ENDED_NOTICE} />;
/** A join to a room that was deleted: no Retry, as in the classic app. */
export const NotFound = () => <Notice {...NOT_FOUND_NOTICE} />;
