import React from "react";
import { Box, Button, Paper, Typography } from "@mui/material";
import { CheckCircleOutline as CaughtUpIcon, DesktopWindows as DesktopIcon } from "@mui/icons-material";
import { Link } from "react-router-dom";
import { ListPageShell } from "../components/Common/PageShell";
import HomeInviteCard from "../components/Home/HomeInviteCard";
import NewUserNextStep from "../components/Home/NewUserNextStep";
import {
  HomeSection,
  MentionList,
  SectionError,
  SectionSkeleton,
  UnreadDmList,
  VoiceNowList,
} from "../components/Home/HomeSections";
import { useHomeSummary } from "../hooks/useHomeSummary";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useResponsive } from "../hooks/useResponsive";
import { isElectron } from "../utils/platform";

const HomePage: React.FC = () => {
  const { isMobile } = useResponsive();

  // Phone and tablet never route "/" here: MobileNavigationContext maps it to
  // the channels screen (see MobileScreenContainer / TabletContentArea).
  if (isMobile) {
    return null;
  }

  return <DesktopHomePage />;
};

const DownloadCard: React.FC = () => (
  <Paper
    variant="outlined"
    data-testid="home-download-card"
    sx={{ p: 2, borderRadius: 2, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}
  >
    <DesktopIcon color="primary" sx={{ fontSize: "icon.2xl" }} />
    <Box sx={{ flex: "1 1 200px", minWidth: 0 }}>
      <Typography variant="subtitle2">Get Semaphore Chat Desktop</Typography>
      <Typography variant="body2" color="text.secondary">
        Available for Windows and Linux
      </Typography>
    </Box>
    <Button
      variant="outlined"
      size="small"
      href="https://docs.semaphorechat.app/installation/desktop-app/"
      target="_blank"
      rel="noopener noreferrer"
    >
      Download
    </Button>
  </Paper>
);

const CaughtUp: React.FC = () => (
  <Paper
    variant="outlined"
    data-testid="home-caught-up"
    sx={{ p: 4, borderRadius: 2, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}
  >
    <CaughtUpIcon color="success" sx={{ fontSize: "icon.3xl", mb: 1 }} />
    <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
      You're all caught up
    </Typography>
    <Typography variant="body2" color="text.secondary">
      No unread mentions or messages, and nobody is in voice right now.
    </Typography>
  </Paper>
);

const DesktopHomePage: React.FC = () => {
  const { user } = useCurrentUser();
  const summary = useHomeSummary();
  const {
    communities,
    mentions,
    unreadDms,
    voice,
    isLoading,
    isChannelsLoading,
    isDmsLoading,
    communitiesError,
    unreadError,
    dmsError,
  } = summary;

  const renderBody = () => {
    if (isLoading) {
      return (
        <>
          <HomeSection title="Mentions">
            <SectionSkeleton label="Loading mentions" />
          </HomeSection>
          <HomeSection title="Unread messages">
            <SectionSkeleton label="Loading messages" />
          </HomeSection>
        </>
      );
    }

    if (communitiesError) {
      return (
        <Paper variant="outlined" sx={{ borderRadius: 2 }}>
          <SectionError title="Couldn't load your communities" onRetry={summary.refetchCommunities} />
        </Paper>
      );
    }

    if (unreadError) {
      return (
        <Paper variant="outlined" sx={{ borderRadius: 2 }}>
          <SectionError title="Couldn't load what's new" onRetry={summary.refetchUnread} />
        </Paper>
      );
    }

    const dmSection =
      dmsError && unreadDms.length === 0 ? (
        <HomeSection title="Unread messages" testId="home-unread-dms">
          <SectionError title="Couldn't load conversations" onRetry={summary.refetchDms} />
        </HomeSection>
      ) : unreadDms.length > 0 ? (
        <HomeSection
          title="Unread messages"
          testId="home-unread-dms"
          action={
            <Button component={Link} to="/direct-messages" size="small">
              All messages
            </Button>
          }
        >
          <UnreadDmList dms={unreadDms} currentUserId={user?.id} />
        </HomeSection>
      ) : null;

    if (communities.length === 0) {
      return (
        <>
          <NewUserNextStep fullWidth />
          {dmSection}
        </>
      );
    }

    const stillLoading = isChannelsLoading || isDmsLoading;
    const nothingNew = mentions.length === 0 && unreadDms.length === 0 && voice.length === 0 && !dmsError;

    return (
      <>
        {mentions.length > 0 ? (
          <HomeSection
            title="Mentions"
            testId="home-mentions"
            action={
              <Button component={Link} to="/notifications" size="small">
                Notifications
              </Button>
            }
          >
            <MentionList mentions={mentions} />
          </HomeSection>
        ) : (
          isChannelsLoading && (
            <HomeSection title="Mentions">
              <SectionSkeleton label="Loading mentions" />
            </HomeSection>
          )
        )}
        {dmSection}
        {voice.length > 0 && (
          <HomeSection title="In voice now" testId="home-voice">
            <VoiceNowList channels={voice} />
          </HomeSection>
        )}
        {nothingNew && !stillLoading && <CaughtUp />}
      </>
    );
  };

  return (
    <ListPageShell title="Home">
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {!isLoading && !communitiesError && <HomeInviteCard communities={communities} />}
        {renderBody()}
        {!isElectron() && <DownloadCard />}
      </Box>
    </ListPageShell>
  );
};

export default HomePage;
