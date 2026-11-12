/**
 * When a ringing direct-message call stops ringing, and when a decline ends
 * the caller's own call. Pure functions so each rule reads (and is tested) on
 * its own, away from the socket wiring.
 */

/** The call the incoming-call banner is ringing for. */
export interface RingingDmCall {
  dmGroupId: string;
}

export interface DmCallDeclined {
  dmGroupId: string;
  userId: string;
  /** Sent by current servers; absent from older ones. */
  isGroup?: boolean;
}

export interface DmCallEnded {
  dmGroupId: string;
}

export interface DmUserJoined {
  dmGroupId: string;
  user: { id: string };
}

/**
 * The same account declined on another device (or a retry of our own
 * decline): this device must stop ringing too.
 */
export function declineStopsMyRinging(
  call: RingingDmCall | null,
  declined: DmCallDeclined,
  myUserId: string | null,
): boolean {
  return (
    !!call &&
    !!myUserId &&
    call.dmGroupId === declined.dmGroupId &&
    declined.userId === myUserId
  );
}

/** Someone joined as me: I answered on another device. */
export function joinStopsMyRinging(
  call: RingingDmCall | null,
  joined: DmUserJoined,
  myUserId: string | null,
): boolean {
  return (
    !!call &&
    !!myUserId &&
    call.dmGroupId === joined.dmGroupId &&
    joined.user.id === myUserId
  );
}

/** The call's presence is empty: the caller gave up before anyone answered. */
export function callEndStopsMyRinging(
  call: RingingDmCall | null,
  ended: DmCallEnded,
): boolean {
  return !!call && call.dmGroupId === ended.dmGroupId;
}

export interface DeclineAgainstMyCall {
  declinedBy: string;
  myUserId: string | null;
  /** The server's word on whether the DM is a group (absent on old servers). */
  isGroupFromServer?: boolean;
  /** The DM-groups cache's word, only used when the server did not say. */
  isGroupFromCache?: boolean;
  /** This device is connected to that DM's call. */
  inThisCall: boolean;
  /** How many people other than me are in that call right now. */
  otherMembersInCall: number;
}

/**
 * In a 1:1 call the other person declining ends the call for the caller, like
 * a phone call. In a group DM nothing ends, however many people decline.
 * Declining on another of my own devices never ends it here. A group DM keeps
 * going: one person declining is only about them. Whether the DM is a group
 * comes from the server, then the cache; a DM nobody can vouch for is treated
 * as a group, since not ending a call is safer than ending one wrongly.
 */
export function declineEndsMyCall(state: DeclineAgainstMyCall): boolean {
  const isGroupDm = state.isGroupFromServer ?? state.isGroupFromCache ?? true;
  return (
    !isGroupDm &&
    !!state.myUserId &&
    state.inThisCall &&
    state.declinedBy !== state.myUserId &&
    state.otherMembersInCall === 0
  );
}
