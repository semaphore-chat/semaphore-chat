import type { DirectMessageGroup } from "../types/direct-message.type";

/**
 * Get a display name for a DM group:
 * - If the group has a custom name, use it
 * - For 1:1 DMs, show the other user's display name or username
 * - For group DMs without a name, show comma-separated member names
 */
export function getDmDisplayName(
  dmGroup: DirectMessageGroup | undefined,
  currentUserId: string | undefined,
): string {
  if (!dmGroup) return "Unknown";
  if (dmGroup.name) return dmGroup.name;

  if (!dmGroup.isGroup && dmGroup.members?.length === 2) {
    const otherMember = dmGroup.members.find(m => m.user.id !== currentUserId);
    return otherMember?.user.displayName || otherMember?.user.username || "Unknown User";
  }

  return dmGroup.members
    ?.filter(m => m.user.id !== currentUserId)
    ?.map(m => m.user.displayName || m.user.username)
    ?.join(", ") || "Group Chat";
}

/**
 * Get the other user in a 1:1 DM group, or undefined for group DMs.
 */
export function getDmOtherUser(
  dmGroup: DirectMessageGroup | undefined,
  currentUserId: string | undefined,
) {
  if (!dmGroup || dmGroup.isGroup || dmGroup.members?.length !== 2) return undefined;
  return dmGroup.members.find(m => m.user.id !== currentUserId)?.user;
}

/**
 * Format a date as a relative time string (e.g., "5m ago", "2h ago", "3d ago").
 */
export function formatLastMessageTime(date: Date | string): string {
  const now = new Date();
  const messageDate = new Date(date);
  const diffMs = now.getTime() - messageDate.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays}d ago`;
  } else if (diffHours > 0) {
    return `${diffHours}h ago`;
  } else {
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    return diffMinutes > 0 ? `${diffMinutes}m ago` : "Just now";
  }
}

/**
 * The name for a DM header, or undefined while it can't be told yet: the
 * group is still loading, or it has no name of its own and the current user
 * (whom the derived name leaves out) hasn't loaded. Callers show a loading
 * placeholder for undefined, never a made-up name.
 */
export function getDmHeaderName(
  dmGroup: DirectMessageGroup | undefined,
  currentUserId: string | undefined,
): string | undefined {
  if (!dmGroup) return undefined;
  if (dmGroup.name) return dmGroup.name;
  if (!currentUserId) return undefined;
  return getDmDisplayName(dmGroup, currentUserId);
}
