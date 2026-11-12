import React, { useState, useEffect } from "react";
import { logger } from "../../utils/logger";
import { getErrorMessage } from "../../utils/format";
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  CircularProgress,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  SelectChangeEvent,
  Snackbar,
  Divider,
  InputAdornment,
} from "@mui/material";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  instanceControllerGetSettingsOptions,
  instanceControllerUpdateSettingsMutation,
} from "../../api-client/@tanstack/react-query.gen";


// Helper functions for byte conversion
const bytesToGB = (bytes: number): number => {
  return Number((bytes / (1024 * 1024 * 1024)).toFixed(2));
};

const gbToBytes = (gb: number): number => {
  return Math.round(gb * 1024 * 1024 * 1024);
};

const bytesToMB = (bytes: number): number => {
  return Number((bytes / (1024 * 1024)).toFixed(2));
};

const mbToBytes = (mb: number): number => {
  return Math.round(mb * 1024 * 1024);
};

const AdminSettingsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, error } = useQuery(instanceControllerGetSettingsOptions());
  const { mutateAsync: updateSettings, isPending: isSaving } = useMutation({
    ...instanceControllerUpdateSettingsMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'instanceControllerGetSettings' }] });
      queryClient.invalidateQueries({ queryKey: [{ _id: 'instanceControllerGetPublicSettings' }] });
    },
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [registrationMode, setRegistrationMode] = useState<"OPEN" | "INVITE_ONLY" | "CLOSED">("INVITE_ONLY");
  const [defaultStorageQuotaGB, setDefaultStorageQuotaGB] = useState<number>(50);
  const [maxFileSizeMB, setMaxFileSizeMB] = useState<number>(500);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // Initialize form with current settings
  useEffect(() => {
    if (settings) {
      setName(settings.name);
      setDescription(settings.description || "");
      setRegistrationMode(settings.registrationMode);
      setDefaultStorageQuotaGB(bytesToGB(settings.defaultStorageQuotaBytes));
      setMaxFileSizeMB(bytesToMB(settings.maxFileSizeBytes));
    }
  }, [settings]);

  const handleSave = async () => {
    try {
      await updateSettings({
        body: {
          name,
          description: description || undefined,
          registrationMode,
          defaultStorageQuotaBytes: gbToBytes(defaultStorageQuotaGB),
          maxFileSizeBytes: mbToBytes(maxFileSizeMB),
        },
      });
      setSuccessMessage("Settings saved successfully");
    } catch (err) {
      // The server validates both storage values; show its message (e.g. a
      // quota below 1 GB) instead of a generic failure.
      setErrorMessage(getErrorMessage(err, "Failed to save settings"));
      logger.error("Failed to save settings:", err);
    }
  };

  const hasChanges =
    settings &&
    (name !== settings.name ||
      description !== (settings.description || "") ||
      registrationMode !== settings.registrationMode ||
      gbToBytes(defaultStorageQuotaGB) !== settings.defaultStorageQuotaBytes ||
      mbToBytes(maxFileSizeMB) !== settings.maxFileSizeBytes);

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">Failed to load settings. Please try again.</Alert>;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom fontWeight="bold">
        Instance Settings
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Configure your instance settings
      </Typography>

      <Card sx={{ maxWidth: 600 }}>
        <CardContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <TextField
              label="Instance Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              helperText="The name of your instance"
            />

            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              multiline
              rows={3}
              helperText="A brief description of your instance (optional)"
            />

            <FormControl fullWidth>
              <InputLabel>Registration Mode</InputLabel>
              <Select
                value={registrationMode}
                label="Registration Mode"
                onChange={(e: SelectChangeEvent) =>
                  setRegistrationMode(e.target.value as "OPEN" | "INVITE_ONLY" | "CLOSED")
                }
              >
                <MenuItem value="OPEN">
                  <Box>
                    <Typography variant="body2">Open</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Anyone can register
                    </Typography>
                  </Box>
                </MenuItem>
                <MenuItem value="INVITE_ONLY">
                  <Box>
                    <Typography variant="body2">Invite Only</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Requires an invite code to register
                    </Typography>
                  </Box>
                </MenuItem>
                <MenuItem value="CLOSED">
                  <Box>
                    <Typography variant="body2">Closed</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Registration is disabled
                    </Typography>
                  </Box>
                </MenuItem>
              </Select>
            </FormControl>

            <Divider sx={{ my: 2 }} />

            <Typography variant="h6" gutterBottom>
              Storage Settings
            </Typography>

            <TextField
              label="Default Storage Quota"
              type="number"
              value={defaultStorageQuotaGB}
              onChange={(e) => setDefaultStorageQuotaGB(Number(e.target.value))}
              fullWidth
              slotProps={{
                input: {
                  endAdornment: <InputAdornment position="end">GB</InputAdornment>,
                },
                htmlInput: { min: 1, step: 1 }
              }}
              helperText="Default storage quota for new users (at least 1 GB)"
            />

            <TextField
              label="Maximum File Size"
              type="number"
              value={maxFileSizeMB}
              onChange={(e) => setMaxFileSizeMB(Number(e.target.value))}
              fullWidth
              slotProps={{
                input: {
                  endAdornment: <InputAdornment position="end">MB</InputAdornment>,
                },
                htmlInput: { min: 1, max: 1024, step: 1 }
              }}
              helperText="Maximum allowed file size for uploads (1 MB to 1 GB)"
            />

            <Box sx={{ display: "flex", justifyContent: "flex-end", pt: 2 }}>
              <Button
                variant="contained"
                onClick={handleSave}
                disabled={!hasChanges || isSaving}
              >
                {isSaving ? <CircularProgress size={24} /> : "Save Changes"}
              </Button>
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Success Snackbar */}
      <Snackbar
        open={!!successMessage}
        autoHideDuration={3000}
        onClose={() => setSuccessMessage("")}
        message={successMessage}
      />

      {/* Error Snackbar */}
      <Snackbar
        open={!!errorMessage}
        autoHideDuration={5000}
        onClose={() => setErrorMessage("")}
      >
        <Alert severity="error" onClose={() => setErrorMessage("")}>
          {errorMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AdminSettingsPage;
