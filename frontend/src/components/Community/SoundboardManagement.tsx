import React, { useState, useCallback, useRef } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  MusicNote as MusicNoteIcon,
  UploadFile as UploadFileIcon,
} from "@mui/icons-material";
import { useUserPermissions } from "../../features/roles/useUserPermissions";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  soundboardControllerListCommunitySoundsOptions,
  soundboardControllerListCommunitySoundsQueryKey,
  soundboardControllerCreateSoundMutation,
  soundboardControllerDeleteSoundMutation,
} from "../../api-client/@tanstack/react-query.gen";
import type { SoundboardSoundDto } from "../../api-client/types.gen";
import { useFileUpload } from "../../hooks/useFileUpload";
import ConfirmDialog from "../Common/ConfirmDialog";
import { SoundPreviewButton } from "./SoundPreviewButton";

interface SoundboardManagementProps {
  communityId: string;
}

const MAX_SOUND_BYTES = 1024 * 1024; // Mirror backend cap (1MB)

const SoundboardManagement: React.FC<SoundboardManagementProps> = ({
  communityId,
}) => {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [soundToDelete, setSoundToDelete] =
    useState<SoundboardSoundDto | null>(null);

  const { hasPermissions: canRead } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId,
    actions: ["READ_SOUNDBOARD_SOUND"],
  });
  const { hasPermissions: canCreate } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId,
    actions: ["CREATE_SOUNDBOARD_SOUND"],
  });
  const { hasPermissions: canDelete } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId,
    actions: ["DELETE_SOUNDBOARD_SOUND"],
  });

  const {
    data: sounds,
    isLoading,
    error,
  } = useQuery({
    ...soundboardControllerListCommunitySoundsOptions({
      path: { communityId },
    }),
    enabled: canRead,
  });

  const { uploadFile, isUploading } = useFileUpload();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: soundboardControllerListCommunitySoundsQueryKey({
        path: { communityId },
      }),
    });
  }, [queryClient, communityId]);

  const { mutateAsync: createSound, isPending: isCreating } = useMutation({
    ...soundboardControllerCreateSoundMutation(),
    onSuccess: invalidate,
  });

  const { mutateAsync: deleteSound, isPending: isDeleting } = useMutation({
    ...soundboardControllerDeleteSoundMutation(),
    onSuccess: invalidate,
  });

  const resetForm = useCallback(() => {
    setName("");
    setEmoji("");
    setSelectedFile(null);
    setFormError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleCloseCreate = useCallback(() => {
    setCreateOpen(false);
    resetForm();
  }, [resetForm]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      setFormError(null);
      if (file && file.size > MAX_SOUND_BYTES) {
        setFormError("Sound is too large. Maximum size is 1MB.");
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
      if (file && !name) {
        // Default the name to the file's base name for convenience
        setName(file.name.replace(/\.[^.]+$/, "").slice(0, 50));
      }
    },
    [name]
  );

  const handleCreate = useCallback(async () => {
    setFormError(null);
    if (!name.trim()) {
      setFormError("Please enter a name.");
      return;
    }
    if (!selectedFile) {
      setFormError("Please choose an audio file.");
      return;
    }

    try {
      const uploaded = await uploadFile(selectedFile, {
        resourceType: "SOUNDBOARD_SOUND",
        resourceId: communityId,
      });
      await createSound({
        path: { communityId },
        body: {
          name: name.trim(),
          emoji: emoji.trim() || undefined,
          fileId: uploaded.id,
        },
      });
      handleCloseCreate();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to create sound."
      );
    }
  }, [
    name,
    emoji,
    selectedFile,
    uploadFile,
    createSound,
    communityId,
    handleCloseCreate,
  ]);

  const handleConfirmDelete = useCallback(async () => {
    if (!soundToDelete) return;
    try {
      await deleteSound({
        path: { communityId, soundId: soundToDelete.id },
      });
      setSoundToDelete(null);
    } catch {
      // surfaced via mutation error state; keep dialog open
    }
  }, [soundToDelete, deleteSound, communityId]);

  if (!canRead) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Soundboard
          </Typography>
          <Alert severity="info">
            You don't have permission to view the soundboard in this community.
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" p={2}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error">Failed to load soundboard. Please try again.</Alert>
    );
  }

  const busy = isUploading || isCreating;

  return (
    <>
      <Card>
        <CardContent>
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            mb={3}
          >
            <Box>
              <Typography variant="h6">Soundboard</Typography>
              <Typography variant="body2" color="text.secondary">
                Upload short audio clips (max 1MB). Members can play them for
                everyone while connected to a voice channel.
              </Typography>
            </Box>
            {canCreate && (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setCreateOpen(true)}
              >
                Add Sound
              </Button>
            )}
          </Box>

          {sounds && sounds.length > 0 ? (
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Sound</TableCell>
                    <TableCell align="center">Preview</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sounds.map((sound) => (
                    <TableRow key={sound.id}>
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={1}>
                          <Box component="span" aria-hidden sx={{ fontSize: "icon.xl" }}>
                            {sound.emoji || "🔊"}
                          </Box>
                          <Typography variant="body2" fontWeight="medium">
                            {sound.name}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="center">
                        <SoundPreviewButton fileId={sound.fileId} />
                      </TableCell>
                      <TableCell align="right">
                        {canDelete && (
                          <Tooltip title="Delete sound">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => setSoundToDelete(sound)}
                            >
                              <DeleteIcon />
                            </IconButton>
                          </Tooltip>
                        )}
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
              <MusicNoteIcon
                sx={{ fontSize: 'icon.5xl', color: "text.secondary", mb: 2 }}
              />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No sounds yet
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                align="center"
                mb={3}
              >
                Add short audio clips that members can play in voice channels.
              </Typography>
              {canCreate && (
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => setCreateOpen(true)}
                >
                  Add Your First Sound
                </Button>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onClose={handleCloseCreate} fullWidth maxWidth="sm">
        <DialogTitle>Add Sound</DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={2} mt={1}>
            {formError && <Alert severity="error">{formError}</Alert>}
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              inputProps={{ maxLength: 50 }}
              fullWidth
              // eslint-disable-next-line jsx-a11y/no-autofocus -- first field of a dialog the user just opened (WAI-ARIA dialog pattern: move focus into it)
              autoFocus
            />
            <TextField
              label="Emoji (optional)"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              inputProps={{ maxLength: 16 }}
              placeholder="📯"
              sx={{ width: 160 }}
            />
            <Button
              variant="outlined"
              startIcon={<UploadFileIcon />}
              component="label"
            >
              {selectedFile ? selectedFile.name : "Choose Audio File"}
              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept="audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/aac"
                onChange={handleFileChange}
              />
            </Button>
            <Typography variant="caption" color="text.secondary">
              MP3, WAV, OGG, WebM, or AAC. Max 1MB.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCreate} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={busy}
            startIcon={busy ? <CircularProgress size={16} /> : undefined}
          >
            {busy ? "Uploading..." : "Add Sound"}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(soundToDelete)}
        title="Delete Sound"
        description={
          <>
            Are you sure you want to delete <strong>{soundToDelete?.name}</strong>
            ? This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        confirmColor="error"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setSoundToDelete(null)}
      />
    </>
  );
};

export default SoundboardManagement;
