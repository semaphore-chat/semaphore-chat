import React from "react";
import { Box, Button, Paper, Typography } from "@mui/material";
import { CheckCircleOutline as CaughtUpIcon, DesktopWindows as DesktopIcon } from "@mui/icons-material";
import { Link } from "react-router-dom";
import { ListPageShell, PageHeader, useShellWidth } from "../components/Common/PageShell";
import HomeInviteCard, { useHomeInviteCard } from "../components/Home/HomeInviteCard";
import {
  HOME_SIDE_COLUMN_PX,
  HOME_SIDE_COLUMN_WIDTH,
  HOME_TWO_COLUMN_PX,
  PAGE_LIST_MAX_WIDTH,
  PAGE_WIDE_MAX_WIDTH,
} from "../constants/layout";
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
  const inviteCard = useHomeInviteCard();

  // What Home shows, split so the layout can place it by width: `pair` is
  // Mentions and Unread messages (side by side on wide shells), `rest` the
  // full-width rows below them. `narrow` keeps one readable column at any width.
  const body = ((): HomeBody => {
    if (isLoading) {
      return {
        pair: [
          <HomeSection key="mentions" title="Mentions">
            <SectionSkeleton label="Loading mentions" />
          </HomeSection>,
          <HomeSection key="dms" title="Unread messages">
            <SectionSkeleton label="Loading messages" />
          </HomeSection>,
        ],
        rest: [],
      };
    }

    if (communitiesError) {
      return {
        pair: [],
        rest: [
          <Paper key="error" variant="outlined" sx={{ borderRadius: 2 }}>
            <SectionError title="Couldn't load your communities" onRetry={summary.refetchCommunities} />
          </Paper>,
        ],
        narrow: true,
      };
    }

    if (unreadError) {
      return {
        pair: [],
        rest: [
          <Paper key="error" variant="outlined" sx={{ borderRadius: 2 }}>
            <SectionError title="Couldn't load what's new" onRetry={summary.refetchUnread} />
          </Paper>,
        ],
        narrow: true,
      };
    }

    const dmSection =
      dmsError && unreadDms.length === 0 ? (
        <HomeSection key="dms" title="Unread messages" testId="home-unread-dms">
          <SectionError title="Couldn't load conversations" onRetry={summary.refetchDms} />
        </HomeSection>
      ) : unreadDms.length > 0 ? (
        <HomeSection
          key="dms"
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
      return { pair: [], rest: [<NewUserNextStep key="next" fullWidth />, dmSection], narrow: true };
    }

    const stillLoading = isChannelsLoading || isDmsLoading;
    const nothingNew = mentions.length === 0 && unreadDms.length === 0 && voice.length === 0 && !dmsError;

    const mentionSection =
      mentions.length > 0 ? (
        <HomeSection
          key="mentions"
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
      ) : isChannelsLoading ? (
        <HomeSection key="mentions" title="Mentions">
          <SectionSkeleton label="Loading mentions" />
        </HomeSection>
      ) : null;

    return {
      pair: [mentionSection, dmSection],
      rest: [
        voice.length > 0 && (
          <HomeSection key="voice" title="In voice now" testId="home-voice">
            <VoiceNowList channels={voice} />
          </HomeSection>
        ),
        nothingNew && !stillLoading && <CaughtUp key="caught-up" />,
      ],
      narrow: nothingNew && !stillLoading,
    };
  })();

  const showInvite = !isLoading && !communitiesError && inviteCard.visible;

  return (
    <ListPageShell maxWidth={PAGE_WIDE_MAX_WIDTH} align="center">
      <HomeLayout
        body={body}
        invite={
          showInvite ? <HomeInviteCard communities={communities} onDismiss={inviteCard.dismiss} /> : null
        }
        download={isElectron() ? null : <DownloadCard />}
      />
    </ListPageShell>
  );
};

interface HomeBody {
  pair: React.ReactNode[];
  rest: React.ReactNode[];
  narrow?: boolean;
}

const Stack: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box sx={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>{children}</Box>
);

/**
 * Home's layout by the shell's width (see HOME_* in constants/layout.ts):
 * - below HOME_TWO_COLUMN_PX (or before it is measured, or with little to show):
 *   one centred column of PAGE_LIST_MAX_WIDTH;
 * - from it: Mentions | Unread messages side by side, the rest full width;
 * - from HOME_SIDE_COLUMN_PX: that, plus a side column for the invite and
 *   download cards (none when both are hidden).
 * The DOM order is the reading order in every mode.
 */
const HomeLayout: React.FC<{ body: HomeBody; invite: React.ReactNode; download: React.ReactNode }> = ({
  body,
  invite,
  download,
}) => {
  const width = useShellWidth();
  const pair = body.pair.filter(Boolean);
  const rest = body.rest.filter(Boolean);
  const hasSide = !!invite || !!download;
  const mode =
    body.narrow || width === null || width < HOME_TWO_COLUMN_PX
      ? "column"
      : width >= HOME_SIDE_COLUMN_PX && hasSide
        ? "side"
        : "two";
  const header = <PageHeader title="Home" />;

  if (mode === "column") {
    return (
      <Box data-testid="home-layout" data-layout="column" sx={{ maxWidth: PAGE_LIST_MAX_WIDTH, mx: "auto" }}>
        {header}
        <Stack>
          {invite}
          {pair}
          {rest}
          {download}
        </Stack>
      </Box>
    );
  }

  const pairGrid = pair.length > 0 && (
    <Box
      data-testid="home-pair"
      sx={{
        display: "grid",
        gridTemplateColumns: pair.length > 1 ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)",
        gap: 3,
        alignItems: "start",
      }}
    >
      {pair}
    </Box>
  );

  if (mode === "two") {
    return (
      <Box data-testid="home-layout" data-layout="two">
        {header}
        <Stack>
          {invite}
          {pairGrid}
          {rest}
          {download}
        </Stack>
      </Box>
    );
  }

  return (
    <Box data-testid="home-layout" data-layout="side">
      {header}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `minmax(0, 1fr) ${HOME_SIDE_COLUMN_WIDTH}px`,
          gap: 3,
          alignItems: "start",
        }}
      >
        <Stack>
          {pairGrid}
          {rest}
        </Stack>
        <Box component="aside" aria-label="Get started" data-testid="home-side">
          <Stack>
            {invite}
            {download}
          </Stack>
        </Box>
      </Box>
    </Box>
  );
};

export default HomePage;
