import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { logger } from "../../utils/logger";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TableSortLabel,
  LinearProgress,
  CircularProgress,
  Alert,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
  Chip,
} from "@mui/material";
import {
  Refresh as RefreshIcon,
  FilterList as FilterIcon,
} from "@mui/icons-material";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  storageQuotaControllerGetUsersStorageListOptions,
  storageQuotaControllerRecalculateUserStorageMutation,
} from "../../api-client/@tanstack/react-query.gen";
import { formatFileSize } from "../../utils/format";

// Get progress bar color based on usage percentage
const getProgressColor = (percent: number): "error" | "warning" | "primary" => {
  if (percent > 90) return "error";
  if (percent > 75) return "warning";
  return "primary";
};

type SortOrder = "asc" | "desc";

const AdminStoragePage: React.FC = () => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [searchParams] = useSearchParams();
  // `?minPercent=90` (e.g. from the dashboard's over-quota item) preselects the usage filter.
  const [minPercentFilter, setMinPercentFilter] = useState<string>(() => {
    const minPercent = searchParams.get("minPercent") ?? "";
    return /^\d+$/.test(minPercent) ? minPercent : "";
  });

  // Build query params
  const queryParams = {
    skip: page * rowsPerPage,
    take: rowsPerPage,
    minPercentUsed: minPercentFilter ? Number(minPercentFilter) : undefined,
  };

  const { data, isLoading, error, refetch } = useQuery(storageQuotaControllerGetUsersStorageListOptions({
    query: queryParams as { skip: number; take: number; minPercentUsed: number },
  }));
  const { mutateAsync: recalculateStorage, isPending: isRecalculating } = useMutation({
    ...storageQuotaControllerRecalculateUserStorageMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'storageQuotaControllerGetUsersStorageList' }] });
      queryClient.invalidateQueries({ queryKey: [{ _id: 'storageQuotaControllerGetUserStorageStats' }] });
    },
  });

  // Sort users client-side (backend sorts by percentUsed desc by default)
  const sortedUsers = React.useMemo(() => {
    if (!data?.users) return [];
    const users = [...data.users];
    if (sortOrder === "asc") {
      users.reverse();
    }
    return users;
  }, [data?.users, sortOrder]);

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleSortToggle = () => {
    setSortOrder(sortOrder === "desc" ? "asc" : "desc");
  };

  const handleRecalculate = async (userId: string) => {
    try {
      await recalculateStorage({ path: { userId } });
      refetch();
    } catch (err) {
      logger.error("Failed to recalculate storage:", err);
    }
  };

  const handleFilterChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    // Only allow numbers
    if (value === "" || /^\d+$/.test(value)) {
      setMinPercentFilter(value);
      setPage(0); // Reset to first page when filter changes
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">Failed to load user storage data. Please try again.</Alert>;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom fontWeight="bold">
        User Storage
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        View and manage storage usage per user
      </Typography>

      <Card>
        <CardContent>
          {/* Filters */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
            <TextField
              size="small"
              label="Min % Used"
              value={minPercentFilter}
              onChange={handleFilterChange}
              placeholder="e.g., 50"
              sx={{ width: 150 }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <FilterIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                  endAdornment: minPercentFilter && (
                    <InputAdornment position="end">%</InputAdornment>
                  ),
                },
              }}
            />
            {minPercentFilter && (
              <Chip
                label={`Showing users ≥${minPercentFilter}%`}
                onDelete={() => setMinPercentFilter("")}
                size="small"
              />
            )}
            <Box sx={{ flexGrow: 1 }} />
            <Typography variant="body2" color="text.secondary">
              {data?.total ?? 0} users
            </Typography>
          </Box>

          {/* Table */}
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>User</TableCell>
                  <TableCell sx={{ minWidth: 250 }}>Storage Used</TableCell>
                  <TableCell sortDirection={sortOrder}>
                    <TableSortLabel
                      active
                      direction={sortOrder}
                      onClick={handleSortToggle}
                    >
                      % Used
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right">Files</TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">
                        {minPercentFilter
                          ? `No users found with ≥${minPercentFilter}% storage usage`
                          : "No users found"}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedUsers.map((user) => (
                    <TableRow key={user.userId} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">
                          {user.username}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box>
                          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                              {formatFileSize(user.usedBytes)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {formatFileSize(user.quotaBytes)}
                            </Typography>
                          </Box>
                          <LinearProgress
                            variant="determinate"
                            value={Math.min(user.percentUsed, 100)}
                            sx={{ height: 6, borderRadius: 1 }}
                            color={getProgressColor(user.percentUsed)}
                          />
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          fontWeight="bold"
                          color={
                            user.percentUsed > 90
                              ? "error.main"
                              : user.percentUsed > 75
                              ? "warning.main"
                              : "text.primary"
                          }
                        >
                          {user.percentUsed.toFixed(1)}%
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2">
                          {user.fileCount.toLocaleString()}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Tooltip title="Recalculate storage">
                          <IconButton
                            size="small"
                            onClick={() => handleRecalculate(user.userId)}
                            disabled={isRecalculating}
                          >
                            <RefreshIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Pagination */}
          <TablePagination
            component="div"
            count={data?.total ?? 0}
            page={page}
            onPageChange={handleChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </CardContent>
      </Card>
    </Box>
  );
};

export default AdminStoragePage;
