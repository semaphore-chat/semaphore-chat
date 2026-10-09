import React, { useEffect } from "react";
import { logger } from "../utils/logger";
import {
  Box,
  Button,
  CircularProgress,
  Alert,
  Container,
  Paper,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { ArrowBack as ArrowBackIcon } from "@mui/icons-material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { userControllerUpdateProfileMutation } from "../api-client/@tanstack/react-query.gen";
import { useCurrentUser } from "../hooks/useCurrentUser";

import { useFileUpload } from "../hooks/useFileUpload";
import { useProfileForm } from "../hooks/useProfileForm";
import { ProfileEditForm } from "../components/Profile";
import { FormPageShell } from "../components/Common/PageShell";
import { useResponsive } from "../hooks/useResponsive";

/** Desktop: the form page shell (one column, no section nav). Phone/tablet: the centred container they had. */
const PageFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isDesktop } = useResponsive();
  return isDesktop ? (
    <FormPageShell>{children}</FormPageShell>
  ) : (
    <Container maxWidth="md" sx={{ py: 3 }}>
      {children}
    </Container>
  );
};

const ProfileEditPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: currentUser, isLoading: isLoadingProfile } = useCurrentUser();
  const { mutateAsync: updateProfile, isPending: isUpdating, error: updateError } = useMutation({
    ...userControllerUpdateProfileMutation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [{ _id: 'userControllerGetProfile' }] }),
  });
  const { uploadFile, isUploading, error: uploadError } = useFileUpload();

  const {
    formData,
    previewUrls,
    formErrors,
    handleInputChange,
    validateForm,
    setFormData,
    setPreviewUrls,
  } = useProfileForm();

  // Populate form when user data loads
  useEffect(() => {
    if (currentUser) {
      setFormData({
        displayName: currentUser.displayName || currentUser.username,
        avatar: null,
        banner: null,
        bio: currentUser.bio || "",
        status: currentUser.status || "",
      });
      setPreviewUrls({
        avatar: currentUser.avatarUrl || null,
        banner: currentUser.bannerUrl || null,
      });
    }
  }, [currentUser, setFormData, setPreviewUrls]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!validateForm() || !currentUser) {
      return;
    }

    try {
      // Upload avatar file if selected
      let avatarFileId: string | null = null;
      if (formData.avatar) {
        const uploadedAvatar = await uploadFile(formData.avatar, {
          resourceType: "USER_AVATAR",
          resourceId: currentUser.id,
        });
        avatarFileId = uploadedAvatar.id;
      }

      // Upload banner file if selected
      let bannerFileId: string | null = null;
      if (formData.banner) {
        const uploadedBanner = await uploadFile(formData.banner, {
          resourceType: "USER_BANNER",
          resourceId: currentUser.id,
        });
        bannerFileId = uploadedBanner.id;
      }

      // Update profile with file IDs (or existing values if no new upload)
      const updateProfileDto: {
        displayName?: string;
        avatar?: string;
        banner?: string;
        bio?: string;
        status?: string;
      } = {
        displayName: formData.displayName.trim(),
        bio: formData.bio,
        status: formData.status,
      };

      if (avatarFileId) {
        updateProfileDto.avatar = avatarFileId;
      }

      if (bannerFileId) {
        updateProfileDto.banner = bannerFileId;
      }

      await updateProfile({ body: updateProfileDto });

      // Navigate to profile page after successful update
      navigate(`/profile/${currentUser.id}`);
    } catch (err) {
      logger.error("Failed to update profile:", err);
    }
  };

  const handleGoBack = () => {
    navigate(-1);
  };

  if (isLoadingProfile) {
    return (
      <PageFrame>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
          <CircularProgress />
        </Box>
      </PageFrame>
    );
  }

  if (!currentUser) {
    return (
      <PageFrame>
        <Alert severity="error">
          Failed to load profile. Please try again.
        </Alert>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <Box mb={3}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={handleGoBack}
          color="inherit"
        >
          Back
        </Button>
      </Box>

      <Paper sx={{ p: 4 }}>
        <Typography variant="h4" gutterBottom fontWeight={600}>
          Edit Profile
        </Typography>

        {(updateError || uploadError) && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {uploadError
              ? `File upload failed: ${uploadError.message}`
              : "Failed to update profile. Please try again."}
          </Alert>
        )}

        <Box component="form" onSubmit={handleSubmit}>
          <ProfileEditForm
            formData={formData}
            previewUrls={previewUrls}
            formErrors={formErrors}
            onDisplayNameChange={handleInputChange("displayName")}
            onAvatarChange={handleInputChange("avatar")}
            onBannerChange={handleInputChange("banner")}
            onBioChange={handleInputChange("bio")}
            onStatusChange={handleInputChange("status")}
          />

          <Box mt={3} display="flex" gap={2}>
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={isUpdating || isUploading || !formData.displayName.trim()}
              fullWidth
            >
              {isUploading ? "Uploading..." : isUpdating ? "Saving..." : "Save Changes"}
            </Button>
            <Button
              variant="outlined"
              size="large"
              onClick={handleGoBack}
              disabled={isUpdating || isUploading}
            >
              Cancel
            </Button>
          </Box>
        </Box>
      </Paper>
    </PageFrame>
  );
};

export default ProfileEditPage;
