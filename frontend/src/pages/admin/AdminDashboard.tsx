import React from "react";
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CircularProgress,
  LinearProgress,
  Divider,
} from "@mui/material";
import {
  People as PeopleIcon,
  Groups as CommunitiesIcon,
  Chat as ChannelsIcon,
  Message as MessagesIcon,
  Link as InvitesIcon,
  Block as BannedIcon,
  Storage as StorageIcon,
  Memory as MemoryIcon,
  Computer as ComputerIcon,
  Warning as WarningIcon,
} from "@mui/icons-material";
import { useTheme } from "@mui/material/styles";
import { useQuery } from "@tanstack/react-query";
import {
  instanceControllerGetStatsOptions,
  storageQuotaControllerGetInstanceStorageStatsOptions,
} from "../../api-client/@tanstack/react-query.gen";
import { formatFileSize } from "../../utils/format";
import PageError from "../../components/Common/PageError";
import { ADMIN_ERROR_COPY } from "../../utils/pageError";

// Helper to format uptime
const formatUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

interface StatCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon, color }) => (
  <Card
    sx={{
      height: "100%",
      position: "relative",
      overflow: "hidden",
      transition: "transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out",
      "&:hover": {
        transform: "translateY(-2px)",
      },
    }}
  >
    {/* Subtle gradient accent at top */}
    <Box
      sx={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 4,
        backgroundImage: `linear-gradient(90deg, ${color} 0%, ${color}88 100%)`,
      }}
    />
    <CardContent sx={{ pt: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <Box
          sx={{
            p: 1.5,
            borderRadius: 2,
            backgroundImage: `linear-gradient(135deg, ${color}25 0%, ${color}15 100%)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {React.cloneElement(icon as React.ReactElement<{ sx?: object }>, {
            sx: { fontSize: 'icon.3xl', color },
          })}
        </Box>
        <Box>
          <Typography variant="h4" fontWeight="bold">
            {value.toLocaleString()}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {title}
          </Typography>
        </Box>
      </Box>
    </CardContent>
  </Card>
);

const AdminDashboard: React.FC = () => {
  const theme = useTheme();
  const { data: stats, isLoading, error, refetch } = useQuery(instanceControllerGetStatsOptions());
  const { data: storageStats, isLoading: storageLoading } = useQuery(storageQuotaControllerGetInstanceStorageStatsOptions());

  if (isLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: 400,
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <PageError error={error} copy={ADMIN_ERROR_COPY} onRetry={() => void refetch()} />;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom fontWeight="bold">
        Dashboard
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Overview of your instance statistics
      </Typography>

      {/* Instance Stats */}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <StatCard
            title="Total Users"
            value={stats?.totalUsers ?? 0}
            icon={<PeopleIcon />}
            color={theme.palette.info.main}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <StatCard
            title="Communities"
            value={stats?.totalCommunities ?? 0}
            icon={<CommunitiesIcon />}
            color={theme.palette.success.main}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <StatCard
            title="Channels"
            value={stats?.totalChannels ?? 0}
            icon={<ChannelsIcon />}
            color={theme.palette.warning.main}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <StatCard
            title="Messages"
            value={stats?.totalMessages ?? 0}
            icon={<MessagesIcon />}
            color={theme.palette.secondary.main}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <StatCard
            title="Active Invites"
            value={stats?.activeInvites ?? 0}
            icon={<InvitesIcon />}
            color={theme.palette.primary.main}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <StatCard
            title="Banned Users"
            value={stats?.bannedUsers ?? 0}
            icon={<BannedIcon />}
            color={theme.palette.error.main}
          />
        </Grid>
      </Grid>

      {/* Storage & Server Stats */}
      <Typography variant="h5" sx={{ mt: 5, mb: 3 }} fontWeight="bold">
        Storage & Server
      </Typography>

      {storageLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size={24} />
        </Box>
      ) : storageStats ? (
        <Grid container spacing={3}>
          {/* Storage Overview Card */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
                  <StorageIcon color="primary" />
                  <Typography variant="h6" fontWeight="bold">
                    Storage Overview
                  </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />

                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Total Used
                  </Typography>
                  <Typography variant="body2" fontWeight="bold">
                    {formatFileSize(storageStats.totalStorageUsedBytes)}
                  </Typography>
                </Box>

                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Total Files
                  </Typography>
                  <Typography variant="body2" fontWeight="bold">
                    {storageStats.totalFileCount.toLocaleString()}
                  </Typography>
                </Box>

                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Avg per User
                  </Typography>
                  <Typography variant="body2" fontWeight="bold">
                    {formatFileSize(storageStats.averageStoragePerUserBytes)}
                  </Typography>
                </Box>

                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Default Quota
                  </Typography>
                  <Typography variant="body2" fontWeight="bold">
                    {formatFileSize(storageStats.defaultQuotaBytes)}
                  </Typography>
                </Box>

                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2" color="text.secondary">
                    Max File Size
                  </Typography>
                  <Typography variant="body2" fontWeight="bold">
                    {formatFileSize(storageStats.maxFileSizeBytes)}
                  </Typography>
                </Box>

                {/* Quota Health */}
                {(storageStats.usersApproachingQuota > 0 || storageStats.usersOverQuota > 0) && (
                  <Box sx={{ mt: 2, p: 1.5, bgcolor: "warning.main", borderRadius: 1, opacity: 0.15 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <WarningIcon color="warning" fontSize="small" />
                      <Typography variant="body2">
                        {storageStats.usersOverQuota > 0 && (
                          <strong>{storageStats.usersOverQuota} users over 90% quota. </strong>
                        )}
                        {storageStats.usersApproachingQuota > 0 && (
                          <span>{storageStats.usersApproachingQuota} users at 75-90%.</span>
                        )}
                      </Typography>
                    </Box>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Server Stats Card */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
                  <ComputerIcon color="primary" />
                  <Typography variant="h6" fontWeight="bold">
                    Server Status
                  </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />

                {/* Memory */}
                <Box sx={{ mb: 2 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">
                      Memory
                    </Typography>
                    <Typography variant="body2" fontWeight="bold">
                      {formatFileSize(storageStats.server.memoryUsedBytes)} / {formatFileSize(storageStats.server.memoryTotalBytes)}
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={storageStats.server.memoryUsedPercent}
                    sx={{ height: 6, borderRadius: 1 }}
                    color={storageStats.server.memoryUsedPercent > 90 ? "error" : storageStats.server.memoryUsedPercent > 75 ? "warning" : "primary"}
                  />
                </Box>

                {/* Disk */}
                {storageStats.server.diskTotalBytes > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                      <Typography variant="body2" color="text.secondary">
                        Disk
                      </Typography>
                      <Typography variant="body2" fontWeight="bold">
                        {formatFileSize(storageStats.server.diskUsedBytes)} / {formatFileSize(storageStats.server.diskTotalBytes)}
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={storageStats.server.diskUsedPercent}
                      sx={{ height: 6, borderRadius: 1 }}
                      color={storageStats.server.diskUsedPercent > 90 ? "error" : storageStats.server.diskUsedPercent > 75 ? "warning" : "primary"}
                    />
                  </Box>
                )}

                {/* CPU & System Info */}
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    CPU
                  </Typography>
                  <Typography variant="body2" fontWeight="bold">
                    {storageStats.server.cpuCores} cores
                  </Typography>
                </Box>

                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Load Average
                  </Typography>
                  <Typography variant="body2" fontWeight="bold">
                    {storageStats.server.loadAverage.map(l => l.toFixed(2)).join(", ")}
                  </Typography>
                </Box>

                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Uptime
                  </Typography>
                  <Typography variant="body2" fontWeight="bold">
                    {formatUptime(storageStats.server.uptime)}
                  </Typography>
                </Box>

                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2" color="text.secondary">
                    Platform
                  </Typography>
                  <Typography variant="body2" fontWeight="bold">
                    {storageStats.server.platform} ({storageStats.server.hostname})
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Storage by Type Card */}
          <Grid size={{ xs: 12 }}>
            <Card>
              <CardContent>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
                  <MemoryIcon color="primary" />
                  <Typography variant="h6" fontWeight="bold">
                    Storage by Type
                  </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />

                <Grid container spacing={2}>
                  {storageStats.storageByType.map((item) => (
                    <Grid size={{ xs: 6, sm: 4, md: 3 }} key={item.type}>
                      <Box sx={{ p: 2, bgcolor: "action.hover", borderRadius: 1, textAlign: "center" }}>
                        <Typography variant="h6" fontWeight="bold">
                          {formatFileSize(item.bytes)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {item.type.replace(/_/g, " ")}
                        </Typography>
                        <Typography variant="caption" color="text.disabled">
                          {item.count.toLocaleString()} files
                        </Typography>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      ) : null}
    </Box>
  );
};

export default AdminDashboard;
