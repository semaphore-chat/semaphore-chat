/**
 * The voice notice in the call slot when there is no call (design F2, §3.5): a join that failed, or why the
 * last call ended, with Retry when trying again can help and Dismiss. It renders `useVoiceNotice()`, the
 * one notice the classic bar's `VoiceNotice` renders too, so Retry and Dismiss are the same functions.
 */
import type { JSX } from 'react';
import { Alert, type AlertSeverity } from '../../../../kit';
import type { VoiceNotice } from '../../../../data/voiceNotice';

export interface VoiceNoticeBarProps {
  notice: Pick<VoiceNotice, 'id' | 'severity' | 'title' | 'message' | 'retryTarget' | 'retry' | 'dismiss'>;
}

const SEVERITY: Record<VoiceNotice['severity'], AlertSeverity> = {
  error: 'danger',
  warning: 'warning',
  info: 'info',
};

export function VoiceNoticeBar({ notice }: VoiceNoticeBarProps): JSX.Element {
  return (
    <div data-testid="lounge-voice-notice">
      <Alert
        key={notice.id}
        severity={SEVERITY[notice.severity]}
        title={notice.title}
        action={notice.retryTarget ? { label: 'Retry', onClick: () => void notice.retry() } : undefined}
        onClose={notice.dismiss}
      >
        {notice.message}
      </Alert>
    </div>
  );
}
