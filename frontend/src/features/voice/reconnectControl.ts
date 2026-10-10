/**
 * Lets a hang-up cancel the automatic rejoin loop that
 * useVoiceForegroundResync runs (it lives in the always-mounted Layout,
 * while hang-up runs from voiceActions). The loop registers its canceller
 * while it runs; leaving voice calls cancelVoiceReconnect().
 */
let canceller: (() => void) | null = null;

export function setVoiceReconnectCanceller(cancel: (() => void) | null): void {
  canceller = cancel;
}

/** Stop a running rejoin loop, if any. Returns whether one was running. */
export function cancelVoiceReconnect(): boolean {
  const cancel = canceller;
  canceller = null;
  if (!cancel) return false;
  cancel();
  return true;
}
