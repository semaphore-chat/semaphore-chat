import React from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Grid,
  LinearProgress,
  Link,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import {
  People as PeopleIcon,
  Groups as CommunitiesIcon,
  Chat as ChannelsIcon,
  Message as MessagesIcon,
  Link as InvitesIcon,
  Block as BannedIcon,
  ErrorOutline as ErrorIcon,
  WarningAmber as WarningIcon,
  CheckCircleOutline as AllGoodIcon,
  ChevronRight as ChevronRightIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import { useQuery } from "@tanstack/react-query";
import {
  instanceControllerGetStatsOptions,
  livekitControllerValidateConfigurationOptions,
  storageQuotaControllerGetInstanceStorageStatsOptions,
} from "../../api-client/@tanstack/react-query.gen";
import type { InstanceStorageStatsDto } from "../../api-client/types.gen";
import { formatFileSize } from "../../utils/format";
import PageError from "../../components/Common/PageError";
import { ADMIN_ERROR_COPY } from "../../utils/pageError";
import { TOUCH_TARGETS } from "../../utils/breakpoints";
import { diskSeverity, getAttentionItems, type AttentionItem } from "./adminAttention";

// Helper to format uptime
const formatUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

/** Counts from a million up are shown compact ("1.2M") so two tiles still fit side by side on a phone. */
const COMPACT_FROM = 1_000_000;
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const formatCount = (value: number) =>
  value >= COMPACT_FROM ? compactFormat.format(value) : value.toLocaleString();

const SectionHeading: React.FC<{ id: string; children: React.ReactNode; action?: React.ReactNode }> = ({
  id,
  children,
  action,
}) => (
  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 1.5 }}>
    <Typography id={id} variant="h6" component="h2" fontWeight="bold">
      {children}
    </Typography>
    {action}
  </Box>
);

// ── Needs attention ─────────────────────────────────────────────────────────

const AttentionRow: React.FC<{ item: AttentionItem; onRetry: () => void }> = ({ item, onRetry }) => {
  const Icon = item.severity === "error" ? ErrorIcon : WarningIcon;
  const actionSx = { minHeight: TOUCH_TARGETS.MINIMUM, flexShrink: 0, alignSelf: { xs: "flex-end", sm: "center" } };

  let action: React.ReactNode;
  if (item.to) {
    action = (
      <Button component={RouterLink} to={item.to} color={item.severity} endIcon={<ChevronRightIcon />} sx={actionSx}>
        {item.actionLabel}
      </Button>
    );
  } else if (item.href) {
    action = (
      <Button
        component="a"
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        color={item.severity}
        endIcon={<OpenInNewIcon />}
        sx={actionSx}
      >
        {item.actionLabel}
      </Button>
    );
  } else {
    action = (
      <Button onClick={onRetry} color={item.severity} sx={actionSx}>
        {item.actionLabel}
      </Button>
    );
  }

  return (
    <Paper
      component="li"
      variant="outlined"
      data-testid={`attention-${item.id}`}
      data-severity={item.severity}
      sx={(theme) => ({
        listStyle: "none",
        display: "flex",
        flexDirection: { xs: "column", sm: "row" },
        alignItems: { xs: "stretch", sm: "center" },
        gap: { xs: 0.5, sm: 2 },
        py: 1,
        pl: 2,
        pr: 1,
        borderLeft: `4px solid ${theme.palette[item.severity].main}`,
        backgroundColor: alpha(theme.palette[item.severity].main, 0.08),
      })}
    >
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, flex: 1, minWidth: 0, py: 0.5 }}>
        <Icon color={item.severity} sx={{ mt: 0.25 }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body1" fontWeight={600} sx={{ overflowWrap: "anywhere" }}>
            {item.title}
          </Typography>
          {item.detail && (
            <Typography variant="body2" color="text.secondary">
              {item.detail}
            </Typography>
          )}
        </Box>
      </Box>
      {action}
    </Paper>
  );
};

const AttentionSection: React.FC<{ items: AttentionItem[]; onRetry: () => void }> = ({ items, onRetry }) => {
  if (items.length === 0) {
    return (
      <Box
        role="status"
        sx={{ display: "flex", alignItems: "center", gap: 1, mb: 4, color: "text.secondary" }}
      >
        <AllGoodIcon color="success" />
        <Typography variant="body1">All good: nothing needs attention.</Typography>
      </Box>
    );
  }
  return (
    <Box component="section" aria-labelledby="admin-attention-heading" sx={{ mb: 4 }}>
      <SectionHeading id="admin-attention-heading">Needs attention</SectionHeading>
      <Stack component="ul" spacing={1} sx={{ m: 0, p: 0 }}>
        {items.map((item) => (
          <AttentionRow key={item.id} item={item} onRetry={onRetry} />
        ))}
      </Stack>
    </Box>
  );
};

// ── Totals ──────────────────────────────────────────────────────────────────

interface StatTileProps {
  label: string;
  value: number;
  icon: React.ReactElement;
  to?: string;
}

const StatTile: React.FC<StatTileProps> = ({ label, value, icon, to }) => {
  const chevron = <ChevronRightIcon sx={{ color: "text.disabled", flexShrink: 0 }} />;
  // Phone: icon and chevron on a top row, the number and label below at full tile width,
  // so labels like "Active invites" fit two tiles side by side. Wider: one row.
  const body = (
    <CardContent
      sx={{
        display: "flex",
        flexDirection: { xs: "column", sm: "row" },
        alignItems: { xs: "stretch", sm: "center" },
        gap: { xs: 0.5, sm: 1.5 },
        "&:last-child": { pb: 2 },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <Box sx={{ color: "text.secondary", display: "flex" }}>{icon}</Box>
        {to && <Box sx={{ display: { xs: "flex", sm: "none" } }}>{chevron}</Box>}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="h5"
          component="p"
          fontWeight="bold"
          title={value.toLocaleString()}
          sx={{ overflowWrap: "anywhere", lineHeight: 1.2 }}
        >
          {formatCount(value)}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
          {label}
        </Typography>
      </Box>
      {to && <Box sx={{ display: { xs: "none", sm: "flex" } }}>{chevron}</Box>}
    </CardContent>
  );
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      {to ? (
        <CardActionArea
          component={RouterLink}
          to={to}
          aria-label={`${label}: ${value.toLocaleString()}`}
          sx={{ height: "100%" }}
        >
          {body}
        </CardActionArea>
      ) : (
        body
      )}
    </Card>
  );
};

const TILE_GRID = { xs: 6, md: 4 } as const;

const TileSkeleton: React.FC = () => (
  <Card variant="outlined">
    <CardContent sx={{ display: "flex", alignItems: "center", gap: 1.5, "&:last-child": { pb: 2 } }}>
      <Skeleton variant="circular" width={24} height={24} />
      <Box sx={{ flex: 1 }}>
        <Skeleton width="50%" height={32} />
        <Skeleton width="70%" />
      </Box>
    </CardContent>
  </Card>
);

// ── Storage & server ────────────────────────────────────────────────────────

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, py: 0.5 }}>
    <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
      {label}
    </Typography>
    <Typography variant="body2" fontWeight="bold" sx={{ textAlign: "right", overflowWrap: "anywhere", minWidth: 0 }}>
      {children}
    </Typography>
  </Box>
);

const UsageBar: React.FC<{
  label: string;
  used: number;
  total: number;
  percent: number;
  color: "primary" | "warning" | "error";
}> = ({ label, used, total, percent, color }) => (
  <Box sx={{ py: 0.5 }}>
    <Row label={label}>
      {formatFileSize(used)} / {formatFileSize(total)} ({Math.round(percent)}%)
    </Row>
    <LinearProgress
      variant="determinate"
      value={Math.min(percent, 100)}
      color={color}
      aria-label={`${label} ${Math.round(percent)}% used`}
      sx={{ height: 6, borderRadius: 1, mt: 0.5 }}
    />
  </Box>
);

const StoragePanel: React.FC<{ storage: InstanceStorageStatsDto }> = ({ storage }) => {
  const { server } = storage;
  return (
    <Card variant="outlined">
      <CardContent>
        <Grid container spacing={{ xs: 2, md: 4 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            {server.diskTotalBytes > 0 && (
              <UsageBar
                label="Server disk"
                used={server.diskUsedBytes}
                total={server.diskTotalBytes}
                percent={server.diskUsedPercent}
                color={diskSeverity(server.diskUsedPercent) ?? "primary"}
              />
            )}
            <UsageBar
              label="Server memory"
              used={server.memoryUsedBytes}
              total={server.memoryTotalBytes}
              percent={server.memoryUsedPercent}
              color="primary"
            />
            <Row label="CPU">{server.cpuCores} cores</Row>
            <Row label="Load average">{server.loadAverage.map((l) => l.toFixed(2)).join(", ")}</Row>
            <Row label="Uptime">{formatUptime(server.uptime)}</Row>
            <Row label="Platform">
              {server.platform} ({server.hostname})
            </Row>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Row label="Files stored">
              {formatFileSize(storage.totalStorageUsedBytes)} in {storage.totalFileCount.toLocaleString()} files
            </Row>
            <Row label="Avg per user">{formatFileSize(storage.averageStoragePerUserBytes)}</Row>
            <Row label="Default quota">{formatFileSize(storage.defaultQuotaBytes)}</Row>
            <Row label="Max file size">{formatFileSize(storage.maxFileSizeBytes)}</Row>
            <Row label="Users at 75–90% of quota">{storage.usersApproachingQuota.toLocaleString()}</Row>
            {storage.storageByType.length > 0 && (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  By type
                </Typography>
                {storage.storageByType.map((item) => (
                  <Row key={item.type} label={item.type.replace(/_/g, " ").toLowerCase()}>
                    {formatFileSize(item.bytes)} · {item.count.toLocaleString()} files
                  </Row>
                ))}
              </Box>
            )}
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};

// ── Page ────────────────────────────────────────────────────────────────────

const AdminDashboard: React.FC = () => {
  const { data: stats, isLoading, error, refetch } = useQuery(instanceControllerGetStatsOptions());
  const storageQuery = useQuery(storageQuotaControllerGetInstanceStorageStatsOptions());
  const { data: livekit } = useQuery(livekitControllerValidateConfigurationOptions());

  if (error) {
    return <PageError error={error} copy={ADMIN_ERROR_COPY} onRetry={() => void refetch()} />;
  }

  const storage = storageQuery.data;
  const attentionReady = !storageQuery.isLoading;
  const attentionItems = getAttentionItems({
    storage,
    storageError: storageQuery.isError,
    livekit,
  });

  const tiles: StatTileProps[] = stats
    ? [
        { label: "Users", value: stats.totalUsers, icon: <PeopleIcon />, to: "/admin/users" },
        { label: "Communities", value: stats.totalCommunities, icon: <CommunitiesIcon />, to: "/admin/communities" },
        { label: "Channels", value: stats.totalChannels, icon: <ChannelsIcon />, to: "/admin/communities" },
        { label: "Messages", value: stats.totalMessages, icon: <MessagesIcon /> },
        { label: "Active invites", value: stats.activeInvites, icon: <InvitesIcon />, to: "/admin/invites" },
        { label: "Banned users", value: stats.bannedUsers, icon: <BannedIcon />, to: "/admin/users?status=banned" },
      ]
    : [];

  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom fontWeight="bold">
        Dashboard
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Overview of your instance
      </Typography>

      {attentionReady ? (
        <AttentionSection items={attentionItems} onRetry={() => void storageQuery.refetch()} />
      ) : (
        <Skeleton variant="rounded" height={48} sx={{ mb: 4 }} aria-label="Checking instance health" />
      )}

      <Box component="section" aria-labelledby="admin-totals-heading" sx={{ mb: 4 }}>
        <SectionHeading id="admin-totals-heading">Totals</SectionHeading>
        <Grid container spacing={{ xs: 1.5, sm: 2 }} aria-busy={isLoading}>
          {isLoading
            ? Array.from({ length: 6 }, (_, i) => (
                <Grid key={i} size={TILE_GRID}>
                  <TileSkeleton />
                </Grid>
              ))
            : tiles.map((tile) => (
                <Grid key={tile.label} size={TILE_GRID}>
                  <StatTile {...tile} />
                </Grid>
              ))}
        </Grid>
      </Box>

      {!storageQuery.isError && (
        <Box component="section" aria-labelledby="admin-storage-heading">
          <SectionHeading
            id="admin-storage-heading"
            action={
              <Link component={RouterLink} to="/admin/storage" underline="hover" variant="body2">
                View storage
              </Link>
            }
          >
            Storage &amp; server
          </SectionHeading>
          {storage ? <StoragePanel storage={storage} /> : <Skeleton variant="rounded" height={220} />}
        </Box>
      )}
    </Box>
  );
};

export default AdminDashboard;
