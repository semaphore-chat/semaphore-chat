/**
 * useChannelPermissions: THE source of what the current user can do in a
 * channel. Components read capabilities from here only — never from roles
 * (see the "channel capabilities" boundary test).
 *
 * Reads one query per community, GET /channels/community/:id/permissions/me
 * (the server already applied overwrites, private channels, timeouts and
 * the instance-owner bypass), and picks the channel out of it. Socket
 * handlers invalidate it on overwrite, role and timeout changes. While it
 * loads (or if it errors) it allows everything: the server still enforces,
 * and a flash of disabled controls would be worse.
 */
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  channelPermissionsControllerGetMyCommunityChannelPermissionsOptions,
  channelPermissionsControllerGetMyCommunityChannelPermissionsQueryKey,
} from "../api-client/@tanstack/react-query.gen";
import type { ChannelCapabilitiesDto } from "../api-client/types.gen";

export type ChannelCapability =
  | "view"
  | "post"
  | "attach"
  | "react"
  | "threadReply"
  | "connect"
  | "speak"
  | "video"
  | "share"
  | "managePermissions";

export interface ChannelPermissions {
  /** Server capabilities, or undefined while loading / on error. */
  caps: ChannelCapabilitiesDto | undefined;
  isLoading: boolean;
  /** Fails open while loading: true until the server says otherwise. */
  can: (capability: ChannelCapability) => boolean;
  /** When the user's community timeout ends, if one is active. */
  timedOutUntil: Date | undefined;
  /** Role names that may post here (for the read-only notice). */
  postingRoleNames: string[];
}

const STALE_TIME_MS = 30_000;

export function useChannelPermissions(
  communityId: string | undefined,
  channelId: string | undefined,
): ChannelPermissions {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    ...channelPermissionsControllerGetMyCommunityChannelPermissionsOptions({
      path: { communityId: communityId ?? "" },
    }),
    enabled: !!communityId,
    staleTime: STALE_TIME_MS,
  });

  const caps = useMemo(
    () => data?.channels.find((c) => c.channelId === channelId),
    [data, channelId],
  );

  const timedOutUntil = useMemo(() => {
    if (!caps?.timedOutUntil) return undefined;
    const date = new Date(caps.timedOutUntil);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }, [caps]);

  // Refetch when the timeout ends so the controls come back on their own
  useEffect(() => {
    if (!timedOutUntil || !communityId) return;
    const ms = timedOutUntil.getTime() - Date.now();
    const timer = setTimeout(
      () => {
        void queryClient.invalidateQueries({
          queryKey: channelPermissionsControllerGetMyCommunityChannelPermissionsQueryKey({
            path: { communityId },
          }),
        });
      },
      Math.max(ms, 0) + 500,
    );
    return () => clearTimeout(timer);
  }, [timedOutUntil, communityId, queryClient]);

  const loaded = !!data && !isError;

  return {
    caps,
    isLoading: !!communityId && isLoading,
    // Loaded and absent from the list means the channel is hidden
    can: (capability) => (loaded ? !!caps?.[capability] : true),
    timedOutUntil,
    postingRoleNames: caps?.postingRoleNames ?? [],
  };
}
