import React, { useCallback, useEffect, useRef } from "react";
import { ServerEvents } from "@semaphore-chat/shared";
import { useServerEvent } from "../../socket-hub/useServerEvent";
import { useIncomingCall } from "../../contexts/IncomingCallContext";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { showNotification } from "../../utils/notifications";
import { useQueryClient } from "@tanstack/react-query";
import {
  directMessagesControllerFindUserDmGroupsQueryKey,
  dmVoicePresenceControllerGetDmPresenceQueryKey,
} from "../../api-client/@tanstack/react-query.gen";
import type { DmVoicePresenceResponseDto } from "../../api-client";
import { getDmDisplayName } from "../../utils/dmHelpers";
import type { DirectMessageGroup } from "../../types/direct-message.type";
import { playSound, stopSound, Sounds } from "../../hooks/useSound";
import { VoiceEndReason, VoiceSessionType } from "../../contexts/VoiceContext";
import {
  callEndStopsMyRinging,
  declineEndsMyCall,
  declineStopsMyRinging,
  joinStopsMyRinging,
  type DmCallDeclined,
  type DmCallEnded,
  type DmUserJoined,
} from "../../features/voice/dmCallRinging";

const RING_INTERVAL_MS = 3500;

export const IncomingCallListener: React.FC = () => {
  const { incomingCall, showIncomingCall, dismissCall } = useIncomingCall();
  const { state: voiceState, actions } = useVoiceConnection();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const ringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Loop the incoming call sound while incomingCall is active
  useEffect(() => {
    if (incomingCall) {
      // Play immediately on arrival
      playSound(Sounds.incomingCall);

      // Then loop every ~3.5s
      ringIntervalRef.current = setInterval(() => {
        playSound(Sounds.incomingCall);
      }, RING_INTERVAL_MS);
    } else {
      // Call dismissed/accepted — stop ringing immediately
      if (ringIntervalRef.current) {
        clearInterval(ringIntervalRef.current);
        ringIntervalRef.current = null;
      }
      stopSound(Sounds.incomingCall);
    }

    return () => {
      if (ringIntervalRef.current) {
        clearInterval(ringIntervalRef.current);
        ringIntervalRef.current = null;
      }
      stopSound(Sounds.incomingCall);
    };
  }, [incomingCall]);

  const handleDmVoiceCallStarted = useCallback(
    (payload: {
      dmGroupId: string;
      startedBy: string;
      starter: {
        id: string;
        username: string;
        displayName?: string | null;
        avatarUrl?: string | null;
      };
    }) => {
      // Don't ring if not logged in
      if (!user) {
        return;
      }

      // Don't ring for our own calls
      if (payload.startedBy === user.id) {
        return;
      }

      // Don't ring if already connected to this DM's voice call
      if (
        voiceState.isConnected &&
        voiceState.contextType === VoiceSessionType.Dm &&
        voiceState.currentDmGroupId === payload.dmGroupId
      ) {
        return;
      }

      const callerName =
        payload.starter.displayName || payload.starter.username;

      // Try to look up the DM group name from the query cache
      let dmGroupName = callerName;
      const queryKey = directMessagesControllerFindUserDmGroupsQueryKey();
      const cachedGroups = queryClient.getQueryData<DirectMessageGroup[]>(queryKey);
      if (cachedGroups) {
        const group = cachedGroups.find((g) => g.id === payload.dmGroupId);
        if (group) {
          dmGroupName = getDmDisplayName(group, user?.id);
        }
      }

      showIncomingCall({
        dmGroupId: payload.dmGroupId,
        dmGroupName,
        callerName,
        callerAvatar: payload.starter.avatarUrl ?? null,
        startedAt: Date.now(),
      });

      // Fire desktop notification
      showNotification({
        title: `${callerName} is calling`,
        body: "Incoming voice call",
        tag: `dm-call-${payload.dmGroupId}`,
        requireInteraction: true,
      });
    },
    [user, voiceState, showIncomingCall, queryClient],
  );

  useServerEvent(ServerEvents.DM_VOICE_CALL_STARTED, handleDmVoiceCallStarted);

  // The banner stops ringing for every way a call can pass us by: we declined
  // (here or on another device), we answered on another device, the caller
  // gave up, or we joined here (IncomingCallContext watches that one).
  const handleDmVoiceCallDeclined = useCallback(
    async (payload: DmCallDeclined) => {
      if (declineStopsMyRinging(incomingCall, payload, user?.id ?? null)) {
        dismissCall();
      }

      if (!user) return;

      // A 1:1 call the other person declined is over for the caller: leave
      // and say why. A group call keeps going.
      const cachedGroups = queryClient.getQueryData<DirectMessageGroup[]>(
        directMessagesControllerFindUserDmGroupsQueryKey(),
      );
      const group = cachedGroups?.find((g) => g.id === payload.dmGroupId);
      const presence = queryClient.getQueryData<DmVoicePresenceResponseDto>(
        dmVoicePresenceControllerGetDmPresenceQueryKey({
          path: { dmGroupId: payload.dmGroupId },
        }),
      );

      const ended = declineEndsMyCall({
        declinedBy: payload.userId,
        myUserId: user.id,
        // The server says; the cache is only for servers that do not yet
        isGroupFromServer: payload.isGroup,
        isGroupFromCache: group?.isGroup,
        inThisCall:
          voiceState.isConnected &&
          voiceState.contextType === VoiceSessionType.Dm &&
          voiceState.currentDmGroupId === payload.dmGroupId,
        otherMembersInCall: presence
          ? presence.users.filter((member) => member.id !== user.id).length
          : 0,
      });

      if (ended) {
        await actions.endVoiceSession(VoiceEndReason.CallDeclined);
      }
    },
    [
      actions,
      dismissCall,
      incomingCall,
      queryClient,
      user,
      voiceState.contextType,
      voiceState.currentDmGroupId,
      voiceState.isConnected,
    ],
  );

  const handleDmVoiceUserJoined = useCallback(
    (payload: DmUserJoined) => {
      if (joinStopsMyRinging(incomingCall, payload, user?.id ?? null)) {
        dismissCall();
      }
    },
    [dismissCall, incomingCall, user],
  );

  const handleDmVoiceCallEnded = useCallback(
    (payload: DmCallEnded) => {
      if (callEndStopsMyRinging(incomingCall, payload)) {
        dismissCall();
      }
    },
    [dismissCall, incomingCall],
  );

  useServerEvent(ServerEvents.DM_VOICE_CALL_DECLINED, handleDmVoiceCallDeclined);
  useServerEvent(ServerEvents.DM_VOICE_USER_JOINED, handleDmVoiceUserJoined);
  useServerEvent(ServerEvents.DM_VOICE_CALL_ENDED, handleDmVoiceCallEnded);

  return null;
};
