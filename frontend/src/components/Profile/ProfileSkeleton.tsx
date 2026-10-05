import React from "react";
import { Box, Container, Paper, Skeleton } from "@mui/material";

/**
 * Loading placeholder shaped like the profile page: back button, banner
 * block, avatar circle overlapping it, name and handle lines, a bio, and the
 * clips card. Keeps the layout from jumping when the profile arrives.
 */
const ProfileSkeleton: React.FC = () => (
  <Container maxWidth="md" sx={{ py: 3 }} role="progressbar" aria-label="Loading profile" aria-busy="true">
    <Box mb={3}>
      <Skeleton variant="rounded" width={88} height={36} />
    </Box>

    <Paper>
      <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 1, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }} />
      <Box sx={{ p: 3, pt: 8, position: "relative" }}>
        <Skeleton
          variant="circular"
          width={120}
          height={120}
          sx={{ position: "absolute", top: -60, left: 24, border: "4px solid", borderColor: "background.paper" }}
        />
        <Box ml={17}>
          <Skeleton variant="text" width="40%" sx={{ fontSize: "2.125rem" }} />
          <Skeleton variant="text" width="25%" />
          <Skeleton variant="text" width="70%" sx={{ mt: 2 }} />
          <Skeleton variant="text" width="55%" />
        </Box>
      </Box>
    </Paper>

    <Paper sx={{ mt: 3, p: 3 }}>
      <Skeleton variant="text" width="20%" sx={{ fontSize: "1.5rem", mb: 2 }} />
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 2 }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} variant="rounded" height={120} />
        ))}
      </Box>
    </Paper>
  </Container>
);

export default ProfileSkeleton;
