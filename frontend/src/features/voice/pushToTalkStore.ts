/**
 * Push-to-talk state shared between the one PTT engine and the UI that shows it.
 *
 * The engine (`usePushToTalk`) runs once per call, in `VoiceSessionEffects`
 * (mounted by `VoiceSessionLayer`, above every shell). Whatever shows the mic
 * button (the old voice bar, the float card, later the new shell's call bar)
 * reads this store through `usePushToTalkStatus()` and transmits through
 * `press`/`release`, so the key keeps working whichever shell is on screen.
 *
 * No livekit-client import: it is read by always-mounted UI.
 */

export interface PushToTalkSnapshot {
  /** The PTT key (or a hold-to-talk control) is held and the mic is on. */
  readonly isKeyHeld: boolean;
}

export interface PushToTalkControls {
  press: () => Promise<void>;
  release: () => Promise<void>;
}

const IDLE: PushToTalkSnapshot = { isKeyHeld: false };

let snapshot: PushToTalkSnapshot = IDLE;
let controls: PushToTalkControls | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export const pushToTalkStore = {
  getSnapshot(): PushToTalkSnapshot {
    return snapshot;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Called by the engine whenever the held state changes. */
  setKeyHeld(isKeyHeld: boolean): void {
    if (snapshot.isKeyHeld === isKeyHeld) return;
    snapshot = isKeyHeld ? { isKeyHeld: true } : IDLE;
    notify();
  },

  /**
   * The engine registers its press/release; returns the unregister function.
   * Unregistering only clears the controls this call registered.
   */
  setControls(next: PushToTalkControls): () => void {
    controls = next;
    return () => {
      if (controls === next) controls = null;
    };
  },

  /** Start transmitting (touch hold-to-talk). No-op when no engine is mounted. */
  press(): Promise<void> {
    return controls ? controls.press() : Promise.resolve();
  },

  /** Stop transmitting. No-op when no engine is mounted. */
  release(): Promise<void> {
    return controls ? controls.release() : Promise.resolve();
  },

  /** Tests only: back to the idle state with no engine. */
  reset(): void {
    snapshot = IDLE;
    controls = null;
    notify();
  },
};
