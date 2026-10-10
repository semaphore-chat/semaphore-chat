import React from "react";
import { Box, Card, CardContent, Skeleton } from "@mui/material";

interface SettingsCardSkeletonProps {
  /** Number of toggle + label rows. */
  rows?: number;
  /** Accessible name announced while loading. */
  label?: string;
}

/**
 * Loading placeholder for a settings card: a title line, then rows of a
 * toggle pill with two label lines (name + helper). Same card chrome as the
 * loaded card so the section doesn't jump when the settings arrive.
 */
const SettingsCardSkeleton: React.FC<SettingsCardSkeletonProps> = ({
  rows = 4,
  label = "Loading settings",
}) => (
  <Card role="progressbar" aria-label={label} aria-busy="true" data-testid="settings-card-skeleton">
    <CardContent>
      <Skeleton variant="text" width="35%" sx={{ fontSize: "scale.xl", mb: 2 }} />
      {Array.from({ length: rows }, (_, i) => (
        <Box
          key={i}
          data-testid="settings-card-skeleton-row"
          sx={{ display: "flex", alignItems: "center", gap: 2, py: 1.5 }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Skeleton variant="text" width={`${55 - (i % 3) * 10}%`} />
            <Skeleton variant="text" width={`${80 - (i % 2) * 15}%`} sx={{ fontSize: "scale.sm" }} />
          </Box>
          <Skeleton variant="rounded" width={40} height={22} sx={{ borderRadius: 11, flexShrink: 0 }} />
        </Box>
      ))}
    </CardContent>
  </Card>
);

export default SettingsCardSkeleton;
