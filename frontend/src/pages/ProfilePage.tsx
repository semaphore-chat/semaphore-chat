import React from "react";
import {
  Box,
  Button,
  Container,
  Paper,
} from "@mui/material";
import { useParams, useNavigate } from "react-router-dom";
import { Edit as EditIcon, ArrowBack as ArrowBackIcon } from "@mui/icons-material";
import { useQuery } from "@tanstack/react-query";
import { userControllerGetUserByIdOptions } from "../api-client/@tanstack/react-query.gen";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { ProfileHeader } from "../components/Profile";
import ProfileSkeleton from "../components/Profile/ProfileSkeleton";
import PageError from "../components/Common/PageError";
import { PROFILE_ERROR_COPY } from "../utils/pageError";
import { ClipLibrary } from "../components/Profile/ClipLibrary";
import { ListPageShell } from "../components/Common/PageShell";
import { useResponsive } from "../hooks/useResponsive";

/** Desktop: the list page shell. Phone/tablet: the centred container they had. */
const PageFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isDesktop } = useResponsive();
  return isDesktop ? (
    <ListPageShell>{children}</ListPageShell>
  ) : (
    <Container maxWidth="md" sx={{ py: 3 }}>
      {children}
    </Container>
  );
};

const ProfilePage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();

  const { user: currentUser } = useCurrentUser();
  const { data: profileUser, isLoading, error, refetch } = useQuery({
    ...userControllerGetUserByIdOptions({ path: { id: userId! } }),
    enabled: !!userId,
  });

  const handleGoBack = () => {
    navigate(-1);
  };

  const handleEditProfile = () => {
    navigate("/profile/edit");
  };

  const isOwnProfile = currentUser?.id === userId;

  if (isLoading) return <ProfileSkeleton />;

  if (error || !profileUser) {
    return (
      <PageFrame>
        <PageError
          error={error}
          copy={PROFILE_ERROR_COPY}
          onRetry={() => void refetch()}
          fullHeight={false}
        />
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <Box mb={3} display="flex" justifyContent="space-between" alignItems="center">
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={handleGoBack}
          color="inherit"
        >
          Back
        </Button>
        {isOwnProfile && (
          <Button
            startIcon={<EditIcon />}
            onClick={handleEditProfile}
            variant="contained"
          >
            Edit Profile
          </Button>
        )}
      </Box>

      <Paper>
        <ProfileHeader user={profileUser} />
      </Paper>

      <Paper sx={{ mt: 3, p: 3 }}>
        <ClipLibrary userId={userId!} isOwnProfile={isOwnProfile} />
      </Paper>
    </PageFrame>
  );
};

export default ProfilePage;
