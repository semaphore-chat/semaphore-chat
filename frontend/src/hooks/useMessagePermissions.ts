import { useMemo } from "react";
import { useCanPerformAction } from "../features/roles/useUserPermissions";
import { RBAC_ACTIONS, RBAC_RESOURCES } from "../constants/rbacActions";
import type { Message } from "../types/message.type";

interface UseMessagePermissionsParams {
  /** The message to check permissions for */
  message: Message;
  /** The current user's ID */
  currentUserId?: string;
}

interface UseMessagePermissionsResult {
  /** Whether the current user can edit this message (only authors) */
  canEdit: boolean;
  /** Whether the current user can delete this message (authors + moderators) */
  canDelete: boolean;
  /** Whether the current user can pin/unpin this message */
  canPin: boolean;
  /** Whether the current user can add reactions to this message */
  canReact: boolean;
  /** Whether the current user is the author of this message */
  isOwnMessage: boolean;
}

/**
 * Hook to check message-related permissions for the current user
 *
 * Encapsulates RBAC logic for message operations, keeping it
 * separate from the presentation component.
 *
 * @param params - Object with message and currentUserId
 * @returns Object with permission booleans
 *
 * @example
 * ```tsx
 * const { canEdit, canDelete, canPin } = useMessagePermissions({
 *   message,
 *   currentUserId: currentUser?.id,
 * });
 *
 * return (
 *   <MessageToolbar
 *     canEdit={canEdit}
 *     canDelete={canDelete}
 *     canPin={canPin}
 *   />
 * );
 * ```
 */
export function useMessagePermissions({
  message,
  currentUserId,
}: UseMessagePermissionsParams): UseMessagePermissionsResult {
  const isOwnMessage = currentUserId === message.authorId;
  const isDm = !message.channelId && !!message.directMessageGroupId;

  // Check if user can moderate messages in this channel.
  // For DMs, skip RBAC — pin is not supported and delete is ownership-only.
  const canDeleteMessage = useCanPerformAction(
    RBAC_RESOURCES.CHANNEL,
    isDm ? undefined : message.channelId,
    RBAC_ACTIONS.DELETE_MESSAGE
  );
  const canPinMessage = useCanPerformAction(
    RBAC_RESOURCES.CHANNEL,
    isDm ? undefined : message.channelId,
    RBAC_ACTIONS.PIN_MESSAGE
  );

  // Users can edit their own messages (backend MessageOwnershipGuard handles permission logic)
  const canEdit = useMemo(() => {
    return isOwnMessage;
  }, [isOwnMessage]);

  // Users can delete their own messages (backend MessageOwnershipGuard handles logic)
  // Users with DELETE_MESSAGE permission can delete any message
  const canDelete = useMemo(() => {
    return isOwnMessage || canDeleteMessage;
  }, [isOwnMessage, canDeleteMessage]);

  // Backend forbids pinning in DMs — only allow for channel messages with permission
  const canPin = !isDm && canPinMessage;

  // In DMs, all participants can react (backend grants DM group members full access).
  // This ensures the toolbar renders even when other permissions are false.
  const canReact = isDm || !!currentUserId;

  return {
    canEdit,
    canDelete,
    canPin,
    canReact,
    isOwnMessage,
  };
}
