import React, { useCallback, useEffect, useRef } from "react";
import { ServerEvents } from "@kraken/shared";
import { useServerEvent } from "../../socket-hub/useServerEvent";
import { useIncomingCall } from "../../contexts/IncomingCallContext";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { showNotification } from "../../utils/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { directMessagesControllerFindUserDmGroupsQueryKey } from "../../api-client/@tanstack/react-query.gen";
import { getDmDisplayName } from "../../utils/dmHelpers";
import type { DirectMessageGroup } from "../../types/direct-message.type";
import { playSound, Sounds } from "../../hooks/useSound";

const RING_INTERVAL_MS = 3500;

export const IncomingCallListener: React.FC = () => {
  const { incomingCall, showIncomingCall } = useIncomingCall();
  const { state: voiceState } = useVoiceConnection();
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
      // Call dismissed/accepted — stop ringing
      if (ringIntervalRef.current) {
        clearInterval(ringIntervalRef.current);
        ringIntervalRef.current = null;
      }
    }

    return () => {
      if (ringIntervalRef.current) {
        clearInterval(ringIntervalRef.current);
        ringIntervalRef.current = null;
      }
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
        voiceState.contextType === "dm" &&
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

  return null;
};
