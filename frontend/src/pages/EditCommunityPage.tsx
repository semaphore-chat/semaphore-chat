import React, { useEffect, useState } from "react";
import { logger } from "../utils/logger";
import {
  Box,
  CircularProgress,
  Alert,
  Tabs,
  Tab,
  Paper,
  Typography,
  Container,
  Breadcrumbs,
  Link,
} from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  communityControllerFindOneOptions,
  communityControllerUpdateMutation,
  channelsControllerFindAllForCommunityOptions,
} from "../api-client/@tanstack/react-query.gen";
import { invalidateCommunityQueries } from "../utils/queryInvalidation";

import { useCommunityForm } from "../hooks/useCommunityForm";
import { useUserPermissions } from "../features/roles/useUserPermissions";
import { useFileUpload } from "../hooks/useFileUpload";
import {
  CommunitySettingsForm,
  CommunityFormContent,
  MemberManagement,
  ChannelManagement,
  PrivateChannelMembership,
  RoleManagement,
  AliasGroupManagement,
  CustomEmojiManagement,
  SoundboardManagement,
} from "../components/Community";
import {
  BanListPanel,
  TimeoutListPanel,
  ModerationLogsPanel,
} from "../components/Moderation";
import { FormPageShell } from "../components/Common/PageShell";
import { useResponsive } from "../hooks/useResponsive";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`community-tabpanel-${index}`}
      aria-labelledby={`community-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `community-tab-${index}`,
    'aria-controls': `community-tabpanel-${index}`,
  };
}

const Root = ({ children }: { children: React.ReactNode }) => (
  <Container maxWidth="lg" sx={{ py: 3 }}>
    {children}
  </Container>
);

const EditCommunityPage: React.FC = () => {
  const navigate = useNavigate();
  const { communityId } = useParams<{ communityId: string }>();
  const [tabValue, setTabValue] = useState(0);
  const { isDesktop } = useResponsive();

  const queryClient = useQueryClient();

  const {
    data: community,
    isLoading: isLoadingCommunity,
    error: communityError,
  } = useQuery({
    ...communityControllerFindOneOptions({ path: { id: communityId! } }),
    enabled: !!communityId,
  });

  const {
    data: channels,
    isLoading: isLoadingChannels,
  } = useQuery({
    ...channelsControllerFindAllForCommunityOptions({ path: { communityId: communityId! } }),
    enabled: !!communityId,
  });

  const { mutateAsync: updateCommunity, isPending: isLoading, error } = useMutation({
    ...communityControllerUpdateMutation(),
    onSuccess: () => invalidateCommunityQueries(queryClient),
  });
  const { uploadFile, isUploading, error: uploadError } = useFileUpload();

  const { hasPermissions: canUpdateCommunity } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId!,
    actions: ["UPDATE_COMMUNITY"],
  });

  const { hasPermissions: canManageMembers } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId!,
    actions: ["READ_MEMBER"],
  });

  const { hasPermissions: canManageChannels } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId!,
    actions: ["CREATE_CHANNEL"],
  });

  const { hasPermissions: canViewModeration } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId!,
    actions: ["VIEW_BAN_LIST"],
  });

  const { hasPermissions: canManageEmojis } = useUserPermissions({
    resourceType: "COMMUNITY",
    resourceId: communityId!,
    actions: ["MANAGE_EMOJIS"],
  });

  const {
    formData,
    previewUrls,
    formErrors,
    handleInputChange,
    validateForm,
    setFormData,
    setPreviewUrls,
  } = useCommunityForm();

  // Populate form when community data loads
  useEffect(() => {
    if (community) {
      setFormData({
        name: community.name || "",
        description: community.description || "",
        avatar: null, // Keep as null for file input
        banner: null, // Keep as null for file input
      });
      setPreviewUrls({
        avatar: community.avatar || null,
        banner: community.banner || null,
      });
    }
  }, [community, setFormData, setPreviewUrls]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!validateForm() || !communityId) {
      return;
    }

    try {
      // Upload avatar file if selected
      let avatarFileId: string | null = null;
      if (formData.avatar) {
        const uploadedAvatar = await uploadFile(formData.avatar, {
          resourceType: "COMMUNITY_AVATAR",
          resourceId: communityId,
        });
        avatarFileId = uploadedAvatar.id;
      }

      // Upload banner file if selected
      let bannerFileId: string | null = null;
      if (formData.banner) {
        const uploadedBanner = await uploadFile(formData.banner, {
          resourceType: "COMMUNITY_BANNER",
          resourceId: communityId,
        });
        bannerFileId = uploadedBanner.id;
      }

      // Update community with file IDs (or existing values if no new upload)
      const updateCommunityDto = {
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        avatar: avatarFileId || (community?.avatar ?? null),
        banner: bannerFileId || (community?.banner ?? null),
      };

      await updateCommunity({
        path: { id: communityId },
        body: updateCommunityDto,
      });

      // Stay on the page after successful update
    } catch (err) {
      logger.error("Failed to update community:", err);
    }
  };

  const handleGoBack = () => {
    navigate(`/community/${communityId}`);
  };

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  if (isLoadingCommunity || isLoadingChannels) {
    return (
      <Root>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
          <CircularProgress />
        </Box>
      </Root>
    );
  }

  if (communityError || !community) {
    return (
      <Root>
        <Alert severity="error">
          Failed to load community. Please try again.
        </Alert>
      </Root>
    );
  }

  // The management sections: tabs on phone/tablet, a section nav on desktop.
  // Every section but the settings form is a table, so it gets the wide column.
  const panels: { id: string; label: string; disabled?: boolean; wide: boolean; content: React.ReactNode }[] = [
    {
      id: "settings",
      label: "Settings",
      disabled: !canUpdateCommunity,
      wide: false,
      content: (
        canUpdateCommunity ? (
          <Box sx={isDesktop ? undefined : { maxWidth: 600, mx: "auto" }}>
            <CommunitySettingsForm
              onSubmit={handleSubmit}
              error={error || uploadError}
              errorMessage={
                uploadError
                  ? `File upload failed: ${uploadError.message}`
                  : "Failed to update community. Please try again."
              }
              isLoading={isLoading || isUploading}
              isFormValid={formData.name.trim().length > 0}
              submitButtonText="Update Community"
              loadingText={isUploading ? "Uploading files..." : "Updating..."}
            >
              <CommunityFormContent
                formData={formData}
                previewUrls={previewUrls}
                formErrors={formErrors}
                onNameChange={handleInputChange("name")}
                onDescriptionChange={handleInputChange("description")}
                onAvatarChange={handleInputChange("avatar")}
                onBannerChange={handleInputChange("banner")}
              />
            </CommunitySettingsForm>
          </Box>
        ) : (
          <Alert severity="warning">
            You don't have permission to update community settings.
          </Alert>
        )
      ),
    },
    {
      id: "members",
      label: "Members",
      disabled: !canManageMembers,
      wide: true,
      content: (
        canManageMembers ? (
          <MemberManagement communityId={communityId!} />
        ) : (
          <Alert severity="warning">
            You don't have permission to manage community members.
          </Alert>
        )
      ),
    },
    {
      id: "channels",
      label: "Channels",
      disabled: !canManageChannels,
      wide: true,
      content: (
        canManageChannels ? (
          <ChannelManagement communityId={communityId!} />
        ) : (
          <Alert severity="warning">
            You don't have permission to manage channels.
          </Alert>
        )
      ),
    },
    {
      id: "private-channels",
      label: "Private Channels",
      disabled: !canManageChannels,
      wide: true,
      content: (
        canManageChannels && channels ? (
          <PrivateChannelMembership 
            channels={channels}
            communityId={communityId!}
          />
        ) : canManageChannels ? (
          <Box display="flex" justifyContent="center" p={2}>
            <CircularProgress />
          </Box>
        ) : (
          <Alert severity="warning">
            You don't have permission to manage private channel membership.
          </Alert>
        )
      ),
    },
    {
      id: "roles",
      label: "Roles",
      wide: true,
      content: (
        <RoleManagement communityId={communityId!} />
      ),
    },
    {
      id: "mention-groups",
      label: "Mention Groups",
      wide: true,
      content: (
        <AliasGroupManagement communityId={communityId!} />
      ),
    },
    {
      id: "custom-emoji",
      label: "Custom Emoji",
      disabled: !canManageEmojis,
      wide: true,
      content: (
        canManageEmojis ? (
          <CustomEmojiManagement communityId={communityId!} />
        ) : (
          <Alert severity="warning">
            You don't have permission to manage custom emojis.
          </Alert>
        )
      ),
    },
    {
      id: "moderation",
      label: "Moderation",
      disabled: !canViewModeration,
      wide: true,
      content: (
        canViewModeration ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              <Box sx={{ flex: "1 1 300px", minWidth: { xs: "100%", sm: 300 } }}>
                <BanListPanel communityId={communityId!} />
              </Box>
              <Box sx={{ flex: "1 1 300px", minWidth: { xs: "100%", sm: 300 } }}>
                <TimeoutListPanel communityId={communityId!} />
              </Box>
            </Box>
            <Box>
              <ModerationLogsPanel communityId={communityId!} />
            </Box>
          </Box>
        ) : (
          <Alert severity="warning">
            You don't have permission to view moderation tools.
          </Alert>
        )
      ),
    },
    {
      id: "soundboard",
      label: "Soundboard",
      wide: true,
      content: (
        <SoundboardManagement communityId={communityId!} />
      ),
    },
  ];
  const active = panels[tabValue];

  const breadcrumbs = (
    <Breadcrumbs>
      <Link
        component="button"
        variant="body1"
        onClick={handleGoBack}
        underline="hover"
        sx={{ cursor: 'pointer' }}
      >
        {community.name}
      </Link>
      <Typography color="text.primary">Manage Community</Typography>
    </Breadcrumbs>
  );

  if (isDesktop) {
    return (
      <FormPageShell
        overline={breadcrumbs}
        title={active.label}
        sections={panels.map(({ id, label, disabled }) => ({ id, label, disabled }))}
        activeSection={active.id}
        onSelectSection={(id) => setTabValue(panels.findIndex((p) => p.id === id))}
        navLabel="Community management sections"
        wide={active.wide}
      >
        <Box role="region" aria-label={active.label}>
          {active.content}
        </Box>
      </FormPageShell>
    );
  }

  return (
    <Root>
      {/* Header */}
      <Box mb={3}>{breadcrumbs}</Box>

      {/* Tabs */}
      <Paper>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs
            value={tabValue}
            onChange={handleTabChange}
            aria-label="community management tabs"
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
          >
            {panels.map((panel, index) => (
              <Tab key={panel.id} label={panel.label} {...a11yProps(index)} disabled={panel.disabled} />
            ))}
          </Tabs>
        </Box>

        {/* Tab Panels */}
        {panels.map((panel, index) => (
          <TabPanel key={panel.id} value={tabValue} index={index}>
            {panel.content}
          </TabPanel>
        ))}
      </Paper>
    </Root>
  );
};

export default EditCommunityPage;
