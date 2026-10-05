/**
 * Channel settings → Permissions: presets over per-channel overwrites.
 *
 * Normal admins pick a card (Normal / Read-only / Announcement; Mods-only
 * comes with phase 3) and, for the read-only kinds, who may post. The
 * overwrite set is built by `buildPresetOverwrites` from
 * @semaphore-chat/shared — the same function the backend e2e applies, so
 * what this writes is what the server accepts: roles ranked above the actor
 * keep what an @everyone deny would take from them (shown as locked
 * "kept automatically" chips), and presets that need actions the actor
 * doesn't hold are disabled. A stored set no preset produces shows as
 * "Custom" with a plain-language summary (the matrix editor is phase 5).
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import TagIcon from "@mui/icons-material/Tag";
import CampaignIcon from "@mui/icons-material/Campaign";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import TuneIcon from "@mui/icons-material/Tune";
import LockIcon from "@mui/icons-material/Lock";
import CheckIcon from "@mui/icons-material/Check";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildPresetOverwrites,
  detectPreset,
  presetDenies,
  type PresetId,
  type PresetRole,
} from "@semaphore-chat/shared";
import {
  channelPermissionsControllerGetOverwritesOptions,
  channelPermissionsControllerReplaceOverwritesMutation,
  channelsControllerUpdateMutation,
  rolesControllerGetCommunityRolesOptions,
  rolesControllerGetMyRolesForCommunityOptions,
} from "../../api-client/@tanstack/react-query.gen";
import type {
  ChannelOverwriteDto,
  ReplaceOverwriteInputDto,
} from "../../api-client/types.gen";
import type { Channel } from "../../types/channel.type";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useResponsive } from "../../hooks/useResponsive";
import { TOUCH_TARGETS } from "../../utils/breakpoints";
import { ACTION_LABELS, type RbacAction } from "../../constants/rbacActions";
import { invalidateChannelQueries } from "../../utils/queryInvalidation";
import { invalidateChannelPermissionQueries } from "../../socket-hub/handlers/communityHandlers";
import { logger } from "../../utils/logger";

type CardId = PresetId | "MODS_ONLY" | "CUSTOM";

interface CardDef {
  id: CardId;
  title: string;
  description: string;
  Icon: typeof TagIcon;
}

const CARDS: CardDef[] = [
  { id: "NORMAL", title: "Normal", description: "Everyone can talk.", Icon: TagIcon },
  {
    id: "READ_ONLY",
    title: "Read-only",
    description: "Everyone reads. Only chosen roles post or react.",
    Icon: VisibilityIcon,
  },
  {
    id: "ANNOUNCEMENT",
    title: "Announcement",
    description: "Only chosen roles post. Everyone can react.",
    Icon: CampaignIcon,
  },
  {
    id: "MODS_ONLY",
    title: "Mods only",
    description: "Coming soon — use Private for now.",
    Icon: ShieldOutlinedIcon,
  },
];

const label = (action: string) => ACTION_LABELS[action as RbacAction] ?? action;

/** "@everyone: can't send messages, attach files · Moderator: can send messages" */
function summarizeOverwrites(
  overwrites: readonly ChannelOverwriteDto[],
  roles: readonly PresetRole[],
): string[] {
  return overwrites.map((o) => {
    const who =
      o.targetType === "EVERYONE"
        ? "@everyone"
        : (roles.find((r) => r.id === o.roleId)?.name ?? "Deleted role");
    const parts = [
      o.allow.length ? `can ${o.allow.map(label).join(", ").toLowerCase()}` : "",
      o.deny.length ? `can't ${o.deny.map(label).join(", ").toLowerCase()}` : "",
    ].filter(Boolean);
    return `${who}: ${parts.join("; ")}`;
  });
}

export interface ChannelPermissionsTabProps {
  channel: Channel;
  onSaved?: () => void;
}

export const ChannelPermissionsTab: React.FC<ChannelPermissionsTabProps> = ({
  channel,
  onSaved,
}) => {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const { shouldUseTouchUI } = useResponsive();
  const chipHeight = shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : 32;
  const isOwner = user?.role === "OWNER";

  const rolesQuery = useQuery(
    rolesControllerGetCommunityRolesOptions({ path: { communityId: channel.communityId } }),
  );
  const myRolesQuery = useQuery(
    rolesControllerGetMyRolesForCommunityOptions({ path: { communityId: channel.communityId } }),
  );
  const overwritesQuery = useQuery(
    channelPermissionsControllerGetOverwritesOptions({ path: { id: channel.id } }),
  );

  const roles: PresetRole[] = useMemo(
    () =>
      (rolesQuery.data?.roles ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        position: r.position,
        actions: r.actions,
      })),
    [rolesQuery.data],
  );
  const myRoles = useMemo(() => myRolesQuery.data?.roles ?? [], [myRolesQuery.data]);
  const actorBestPosition = isOwner
    ? null
    : myRoles.length
      ? Math.min(...myRoles.map((r) => r.position))
      : Number.MAX_SAFE_INTEGER;
  const held = useMemo(() => new Set(myRoles.flatMap((r) => r.actions as string[])), [myRoles]);

  const stored = useMemo(
    () => detectPreset(overwritesQuery.data?.overwrites ?? []),
    [overwritesQuery.data],
  );

  const [card, setCard] = useState<CardId>("NORMAL");
  const [postRoleIds, setPostRoleIds] = useState<string[]>([]);
  const [membersCanAttach, setMembersCanAttach] = useState(true);
  const [isPrivate, setIsPrivate] = useState(channel.isPrivate);
  const [error, setError] = useState<string | null>(null);

  // Start from what is stored
  useEffect(() => {
    if (!overwritesQuery.data) return;
    setCard(stored.preset);
    setPostRoleIds(stored.postRoleIds);
    setMembersCanAttach(stored.membersCanAttach);
  }, [overwritesQuery.data, stored]);
  useEffect(() => setIsPrivate(channel.isPrivate), [channel.isPrivate]);

  /** Roles the actor may pick (strictly below them; everything for the owner). */
  const selectable = (role: PresetRole) =>
    actorBestPosition === null || role.position > actorBestPosition;

  const presetMissing = (preset: PresetId): string[] =>
    isOwner ? [] : presetDenies(preset, false).filter((a) => !held.has(a));

  const chooseCard = (id: CardId) => {
    if (id === "MODS_ONLY" || id === "CUSTOM") return;
    setCard(id);
    setError(null);
    if ((id === "READ_ONLY" || id === "ANNOUNCEMENT") && postRoleIds.length === 0) {
      // Default posters: the roles below the actor that manage permissions
      setPostRoleIds(
        roles
          .filter((r) => selectable(r) && r.actions.includes("MANAGE_CHANNEL_PERMISSIONS"))
          .map((r) => r.id),
      );
    }
  };

  const built =
    card === "NORMAL" || card === "READ_ONLY" || card === "ANNOUNCEMENT"
      ? buildPresetOverwrites({
          preset: card,
          postRoleIds,
          membersCanAttach,
          roles,
          actorBestPosition,
        })
      : null;

  const replace = useMutation({
    ...channelPermissionsControllerReplaceOverwritesMutation(),
  });
  const update = useMutation({ ...channelsControllerUpdateMutation() });

  const dirty =
    isPrivate !== channel.isPrivate ||
    (built !== null &&
      (card !== stored.preset ||
        JSON.stringify([...postRoleIds].sort()) !== JSON.stringify([...stored.postRoleIds].sort()) ||
        membersCanAttach !== stored.membersCanAttach));

  const handleSave = async () => {
    setError(null);
    try {
      if (isPrivate !== channel.isPrivate) {
        await update.mutateAsync({ path: { id: channel.id }, body: { isPrivate } });
      }
      if (built) {
        await replace.mutateAsync({
          path: { id: channel.id },
          // The shared builder's plain strings are the DTO's enum values
          body: {
            preset: built.preset,
            overwrites: built.overwrites as ReplaceOverwriteInputDto[],
          },
        });
      }
      invalidateChannelQueries(queryClient);
      invalidateChannelPermissionQueries(queryClient);
      onSaved?.();
    } catch (err) {
      logger.error("Failed to save channel permissions:", err);
      const message =
        (err as { message?: string })?.message ?? "Couldn't save the channel permissions.";
      setError(message);
    }
  };

  if (rolesQuery.isLoading || myRolesQuery.isLoading || overwritesQuery.isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }} aria-busy="true">
        <CircularProgress size={28} />
      </Box>
    );
  }
  if (overwritesQuery.isError || rolesQuery.isError) {
    return <Alert severity="error">Couldn't load this channel's permissions.</Alert>;
  }

  const cards: CardDef[] =
    stored.preset === "CUSTOM" || card === "CUSTOM"
      ? [
          ...CARDS,
          {
            id: "CUSTOM",
            title: "Custom",
            description: "Set with the advanced editor.",
            Icon: TuneIcon,
          },
        ]
      : CARDS;
  const showPosters = card === "READ_ONLY" || card === "ANNOUNCEMENT";
  const autoIds = new Set(built?.autoAllowedRoleIds ?? []);

  return (
    <Stack spacing={2.5} sx={{ pt: 1 }}>
      <FormControlLabel
        control={
          <Switch
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            inputProps={{ "aria-describedby": "private-channel-help" }}
          />
        }
        label={
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Private channel
            </Typography>
            <Typography id="private-channel-help" variant="caption" color="text.secondary">
              Only members you add can see it.
            </Typography>
          </Box>
        }
      />

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Channel type
        </Typography>
        <Box
          role="radiogroup"
          aria-label="Channel permission preset"
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            gap: 1,
          }}
        >
          {cards.map(({ id, title, description, Icon }) => {
            const missing =
              id === "NORMAL" || id === "READ_ONLY" || id === "ANNOUNCEMENT"
                ? presetMissing(id)
                : [];
            const disabled = id === "MODS_ONLY" || id === "CUSTOM" ? id !== card : missing.length > 0;
            const selected = card === id;
            const reason =
              missing.length > 0
                ? `You need ${missing.map(label).join(", ").toLowerCase()} to use this`
                : "";
            return (
              <Tooltip key={id} title={reason}>
                <Box
                  role="radio"
                  aria-checked={selected}
                  aria-disabled={disabled}
                  tabIndex={disabled ? -1 : 0}
                  data-testid={`preset-${id}`}
                  onClick={() => !disabled && chooseCard(id)}
                  onKeyDown={(e) => {
                    if (!disabled && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      chooseCard(id);
                    }
                  }}
                  sx={(theme) => ({
                    display: "flex",
                    gap: 1.5,
                    alignItems: "flex-start",
                    p: 1.5,
                    minHeight: 64,
                    borderRadius: 1.5,
                    border: 1,
                    borderColor: selected ? "primary.main" : "divider",
                    bgcolor: selected ? alpha(theme.palette.primary.main, 0.08) : "transparent",
                    cursor: disabled ? "default" : "pointer",
                    opacity: disabled && !selected ? 0.5 : 1,
                    outline: "none",
                    "&:focus-visible": { boxShadow: `0 0 0 2px ${theme.palette.primary.main}` },
                  })}
                >
                  <Icon sx={{ mt: 0.25, color: selected ? "primary.main" : "text.secondary" }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {description}
                    </Typography>
                  </Box>
                </Box>
              </Tooltip>
            );
          })}
        </Box>
      </Box>

      {card === "CUSTOM" && (
        <Box data-testid="custom-summary">
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Current overwrites
          </Typography>
          {summarizeOverwrites(overwritesQuery.data?.overwrites ?? [], roles).map((line) => (
            <Typography key={line} variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
              {line}
            </Typography>
          ))}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            Choosing a preset above replaces these.
          </Typography>
        </Box>
      )}

      {showPosters && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Roles that can post
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {roles.map((role) => {
              const pickable = selectable(role);
              const auto = autoIds.has(role.id) || (!pickable && built?.overwrites.some((o) => o.roleId === role.id));
              if (!pickable && !auto) return null;
              const on = postRoleIds.includes(role.id);
              return pickable ? (
                <Chip
                  key={role.id}
                  label={role.name}
                  // The theme tints every chip alike: selected ones get a
                  // check, unselected ones an outline only
                  icon={on ? <CheckIcon /> : undefined}
                  onClick={() =>
                    setPostRoleIds((ids) =>
                      on ? ids.filter((id) => id !== role.id) : [...ids, role.id],
                    )
                  }
                  aria-pressed={on}
                  sx={{
                    maxWidth: "100%",
                    height: chipHeight,
                    ...(!on && {
                      bgcolor: "transparent",
                      color: "text.secondary",
                      border: 1,
                      borderColor: "divider",
                    }),
                  }}
                />
              ) : (
                <Tooltip key={role.id} title="Kept automatically: this role ranks at or above yours">
                  <Chip
                    icon={<LockIcon />}
                    label={role.name}
                    sx={{ maxWidth: "100%", height: chipHeight }}
                    data-testid={`auto-role-${role.id}`}
                  />
                </Tooltip>
              );
            })}
          </Box>
        </Box>
      )}

      {card === "NORMAL" && (
        <FormControlLabel
          control={
            <Switch
              checked={membersCanAttach}
              onChange={(e) => setMembersCanAttach(e.target.checked)}
            />
          }
          label="Members can attach files"
        />
      )}

      {error && <Alert severity="error">{error}</Alert>}

      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          variant="contained"
          onClick={handleSave}
          sx={{ minHeight: shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : undefined }}
          disabled={!dirty || replace.isPending || update.isPending}
        >
          {replace.isPending || update.isPending ? <CircularProgress size={20} /> : "Save permissions"}
        </Button>
      </Box>
    </Stack>
  );
};

export default ChannelPermissionsTab;
