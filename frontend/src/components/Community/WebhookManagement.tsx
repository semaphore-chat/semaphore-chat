import React, { useCallback, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Add as AddIcon,
  ContentCopy as ContentCopyIcon,
  Delete as DeleteIcon,
} from "@mui/icons-material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  webhooksControllerCreateMutation,
  webhooksControllerFindAllForChannelOptions,
  webhooksControllerFindAllForChannelQueryKey,
  webhooksControllerRemoveMutation,
} from "../../api-client/@tanstack/react-query.gen";
import type { WebhookDto } from "../../api-client/types.gen";
import { useUserPermissions } from "../../features/roles/useUserPermissions";
import { copyToClipboard } from "../../utils/clipboard";
import ConfirmDialog from "../Common/ConfirmDialog";

interface WebhookManagementProps {
  channelId: string;
}

const WebhookManagement: React.FC<WebhookManagementProps> = ({ channelId }) => {
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [webhookToDelete, setWebhookToDelete] = useState<WebhookDto | null>(null);
  const [createdWebhookUrl, setCreatedWebhookUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const { hasPermissions: canManage } = useUserPermissions({
    resourceType: "CHANNEL",
    resourceId: channelId,
    actions: ["MANAGE_WEBHOOKS"],
  });

  const {
    data: webhooks,
    isLoading,
    error: listError,
  } = useQuery({
    ...webhooksControllerFindAllForChannelOptions({ path: { channelId } }),
    enabled: canManage,
  });

  const invalidate = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: webhooksControllerFindAllForChannelQueryKey({
          path: { channelId },
        }),
      }),
    [queryClient, channelId],
  );

  const { mutateAsync: createWebhook, isPending: creating } = useMutation({
    ...webhooksControllerCreateMutation(),
    onSuccess: invalidate,
  });
  const { mutateAsync: deleteWebhook, isPending: deleting } = useMutation({
    ...webhooksControllerRemoveMutation(),
    onSuccess: invalidate,
  });

  const resetForm = () => {
    setName("");
    setAvatarUrl("");
    setActionError(null);
  };

  const handleCreate = useCallback(async () => {
    setActionError(null);
    const trimmedName = name.trim();
    if (trimmedName.length < 1 || trimmedName.length > 80) {
      setActionError("Name must be between 1 and 80 characters.");
      return;
    }
    try {
      const created = await createWebhook({
        path: { channelId },
        body: {
          name: trimmedName,
          ...(avatarUrl.trim() ? { avatarUrl: avatarUrl.trim() } : {}),
        },
      });
      resetForm();
      setCreatedWebhookUrl(created.url);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to create webhook.");
    }
  }, [name, avatarUrl, createWebhook, channelId]);

  const handleConfirmDelete = useCallback(async () => {
    if (!webhookToDelete) return;
    setActionError(null);
    try {
      await deleteWebhook({
        path: { channelId, webhookId: webhookToDelete.id },
      });
    } catch (err) {
      // Close the confirm dialog even on failure so the error banner
      // below the webhook form (which the dialog would otherwise cover)
      // is visible to the user.
      setActionError(err instanceof Error ? err.message : "Failed to delete webhook.");
    } finally {
      setWebhookToDelete(null);
    }
  }, [webhookToDelete, deleteWebhook, channelId]);

  const handleCopy = useCallback(async () => {
    if (!createdWebhookUrl) return;
    setActionError(null);

    try {
      await copyToClipboard(createdWebhookUrl);
      setCopied(true);
    } catch {
      // Clipboard access unavailable (no permission / insecure context) or
      // failed — select the URL so the user can still copy it manually.
      urlInputRef.current?.select();
      setActionError(
        "Couldn't copy automatically — the URL is selected above so you can copy it manually.",
      );
    }
  }, [createdWebhookUrl]);

  const handleCloseCreatedDialog = useCallback(() => {
    setCreatedWebhookUrl(null);
    setCopied(false);
    setActionError(null);
  }, []);

  if (!canManage) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Webhooks
          </Typography>
          <Alert severity="info">
            You don't have permission to manage webhooks for this channel.
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardContent>
          <Box mb={3}>
            <Typography variant="h6">Webhooks</Typography>
            <Typography variant="body2" color="text.secondary">
              Webhooks let external tools post plain-text messages into this channel.
              Each webhook gets a unique URL — anyone with the URL can post as it, so
              keep it secret.
            </Typography>
          </Box>

          <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
              <TextField
                size="small"
                label="Name"
                placeholder="CI Bot"
                value={name}
                onChange={(e) => setName(e.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                size="small"
                label="Avatar URL (optional)"
                placeholder="https://example.com/avatar.png"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                sx={{ flex: 1 }}
              />
              <Button
                variant="contained"
                startIcon={creating ? <CircularProgress size={16} /> : <AddIcon />}
                onClick={handleCreate}
                disabled={creating || !name.trim()}
              >
                Create Webhook
              </Button>
            </Stack>
            {actionError && !createdWebhookUrl && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {actionError}
              </Alert>
            )}
          </Paper>

          {listError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Failed to load webhooks. Please try again.
            </Alert>
          )}

          {isLoading ? (
            <Box display="flex" justifyContent="center" p={2}>
              <CircularProgress />
            </Box>
          ) : webhooks && webhooks.length > 0 ? (
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Webhook</TableCell>
                    <TableCell>Created</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {webhooks.map((webhook) => (
                    <TableRow key={webhook.id}>
                      <TableCell>
                        <Stack direction="row" spacing={1.5} alignItems="center">
                          <Avatar src={webhook.avatarUrl ?? undefined} sx={{ width: 28, height: 28 }}>
                            {webhook.name.charAt(0).toUpperCase()}
                          </Avatar>
                          <Typography variant="body2">{webhook.name}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {new Date(webhook.createdAt).toLocaleDateString()}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Delete webhook">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => setWebhookToDelete(webhook)}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Box
              display="flex"
              flexDirection="column"
              alignItems="center"
              justifyContent="center"
              py={4}
            >
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No webhooks yet
              </Typography>
              <Typography variant="body2" color="text.secondary" align="center">
                Create one above to let an external tool post into this channel.
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!webhookToDelete}
        title="Delete Webhook"
        description={
          <>
            Are you sure you want to delete <strong>{webhookToDelete?.name}</strong>?
            Its URL will stop working immediately.
          </>
        }
        confirmLabel="Delete"
        confirmColor="error"
        isLoading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setWebhookToDelete(null)}
      />

      <Dialog open={!!createdWebhookUrl} onClose={handleCloseCreatedDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Webhook Created</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Copy this URL now — for security, you won't be able to see it again.
            Anyone with this URL can post messages into this channel.
          </DialogContentText>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              value={createdWebhookUrl ?? ""}
              fullWidth
              size="small"
              inputRef={urlInputRef}
              slotProps={{ htmlInput: { readOnly: true, "aria-label": "Webhook URL" } }}
            />
            <Tooltip title={copied ? "Copied!" : "Copy to clipboard"}>
              <IconButton onClick={handleCopy} aria-label="Copy webhook URL">
                <ContentCopyIcon />
              </IconButton>
            </Tooltip>
          </Stack>
          {copied ? (
            <Typography variant="caption" color="success.main" sx={{ mt: 1, display: "block" }}>
              Copied to clipboard.
            </Typography>
          ) : (
            actionError && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {actionError}
              </Alert>
            )
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCreatedDialog} variant="contained">
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default WebhookManagement;
