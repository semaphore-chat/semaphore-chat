/**
 * The new shell's call bar (shell/lounge/pieces/call/CallBar.tsx) in the frame's call slot, from a fake of
 * the call model (no LiveKit): every phase and mic mode. Every width: the room with its line (the Open call view
 * control), mute (or hold to talk), Deafen and Leave. A reason the mic cannot open is a line of its own, in full.
 */
import { useEffect } from 'react';
import { useToasts } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { CallBar } from '../../shell/lounge/pieces/call/CallBar';
import type { CallBarModel } from '../../data/callBar';
import type { ModeName } from '../../theme/derive/derivePalette';
import { CallSlotFrame } from '../fixtures/CallSlotFrame';
import { DM_PLACE, LONG_PLACE, MIC, fakeCallBarModel } from '../fixtures/callBarFixtures';

function Bar({ mode = 'dark', ...model }: Partial<Omit<CallBarModel, 'actions'>> & { mode?: ModeName }) {
  return <CallSlotFrame mode={mode}>{() => <CallBar model={fakeCallBarModel(model)} />}</CallSlotFrame>;
}

/** Connected, voice activity, mic live. */
export const Connected = () => <Bar />;
/** The same, light. */
export const ConnectedLight = () => <Bar mode="light" />;
/** Someone else is talking. */
export const Talking = () => <Bar talking="dropbear" />;
/** Muted. */
export const Muted = () => <Bar mic={MIC.muted} />;
/** Muted, light. */
export const MutedLight = () => <Bar mode="light" mic={MIC.muted} />;
/** A moderator muted you: the mic is disabled and the line says why. */
export const ServerMuted = () => <Bar mic={MIC.serverMuted} />;
/** No permission to speak: unavailable, with the reason. */
export const Blocked = () => <Bar mic={MIC.blocked} />;
/** Timed out: the longest reason, with its end time, in full on two lines at most. */
export const TimedOut = () => <Bar mic={MIC.timedOut} />;
/** Deafened (Deafen pressed at every width). */
export const Deafened = () => <Bar mic={MIC.muted} deafened />;
/** Deafened, then Mute pressed (the classic Mute does not undeafen): the line says the mic is on. */
export const DeafenedMicOn = () => <Bar mic={MIC.live} deafened />;
/** Deafened, light. */
export const DeafenedLight = () => <Bar mode="light" mic={MIC.muted} deafened />;
/** Push-to-talk with a key, idle: "Hold V to talk". */
export const PttKey = () => <Bar mic={MIC.pttIdle} />;
/** Push-to-talk with the key held. */
export const PttKeyHeld = () => <Bar mic={MIC.pttHeld} />;
/** Touch hold-to-talk, idle. */
export const HoldToTalk = () => <Bar mic={MIC.holdIdle} />;
/** Touch hold-to-talk, held (transmitting). */
export const HoldToTalkHeld = () => <Bar mic={MIC.holdHeld} />;
/** Hold-to-talk while a moderator muted you: nothing to hold. */
export const HoldToTalkBlocked = () => <Bar mic={MIC.holdServerMuted} />;
/** Joining: the room and "Joining…", no controls. */
export const Connecting = () => <Bar phase="connecting" />;
/** Reconnecting, attempt 2, with Cancel. */
export const Reconnecting = () => <Bar phase="reconnecting" reconnectAttempt={2} />;
/** Reconnecting while a moderator has you muted: the reason stays, nothing says "connected". */
export const ReconnectingServerMuted = () => <Bar phase="reconnecting" reconnectAttempt={2} mic={MIC.serverMuted} />;
/** Reconnecting, light. */
export const ReconnectingLight = () => <Bar mode="light" phase="reconnecting" reconnectAttempt={2} />;
/** A typical room name: whole at every width, the 288 px column included. */
export const TypicalName = () => (
  <Bar place={{ kind: 'channel', name: 'Movie night', channelId: 'vc-3', communityId: 'c-1' }} mic={MIC.muted} />
);
/** A very long room name: it truncates, the controls keep their place. */
export const LongName = () => <Bar place={LONG_PLACE} talking="dropbear-with-a-long-display-name" />;
/** A direct-message call. */
export const Dm = () => <Bar place={DM_PLACE} kindLabel="DM Voice Call" callViewPath="/direct-messages/dm-1" />;
/** A direct-message call, light. */
export const DmLight = () => <Bar mode="light" place={DM_PLACE} kindLabel="DM Voice Call" />;

/** Keeps one toast on screen (re-shown before it expires), for the "toast never covers the bar" check. */
function KeepToast() {
  const toasts = useToasts();
  useEffect(() => {
    const request = { id: 'copied', message: 'Link copied to the clipboard' };
    toasts.show(request);
    const again = setInterval(() => toasts.show(request), tokens.motion.toast / 2);
    return () => clearInterval(again);
  }, [toasts]);
  return null;
}

/** A toast while in a call: it sits in the main island, above the bar and the dock, never over them. */
export const WithToast = () => (
  <CallSlotFrame>
    {() => (
      <>
        <KeepToast />
        <CallBar model={fakeCallBarModel({ talking: 'dropbear' })} />
      </>
    )}
  </CallSlotFrame>
);
