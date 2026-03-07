/**
 * UserSearchAutocomplete Component
 *
 * Reusable autocomplete component for searching and selecting users.
 * Supports both single and multiple selection modes.
 */

import React, { useState, useMemo } from "react";
import {
  Autocomplete,
  TextField,
  Chip,
  CircularProgress,
  Box,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { userControllerSearchUsersOptions, userControllerGetProfileOptions } from "../../api-client/@tanstack/react-query.gen";
import { useDebounce } from "../../hooks/useDebounce";
import UserAvatar from "./UserAvatar";

export interface UserOption {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

interface UserSearchAutocompleteProps {
  /** Selected user(s) - single User or array for multiple mode */
  value: UserOption | UserOption[] | null;
  /** Callback when selection changes */
  onChange: (value: UserOption | UserOption[] | null) => void;
  /** Allow multiple user selection */
  multiple?: boolean;
  /** Label for the input field */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Exclude these user IDs from results */
  excludeUserIds?: string[];
  /** Exclude current user from results (default: true) */
  excludeCurrentUser?: boolean;
  /** Disable the input */
  disabled?: boolean;
  /** Auto focus the input */
  autoFocus?: boolean;
  /** Render extra content (e.g. a Chip) at the end of each option row */
  renderOptionExtra?: (user: UserOption) => React.ReactNode;
  /** Disable specific options (passed to MUI Autocomplete) */
  getOptionDisabled?: (user: UserOption) => boolean;
}

const UserSearchAutocomplete: React.FC<UserSearchAutocompleteProps> = ({
  value,
  onChange,
  multiple = false,
  label = "Search users",
  placeholder = "Type to search users...",
  excludeUserIds = [],
  excludeCurrentUser = true,
  disabled = false,
  autoFocus = false,
  renderOptionExtra,
  getOptionDisabled,
}) => {
  const [inputValue, setInputValue] = useState("");
  const debouncedQuery = useDebounce(inputValue.trim(), 300);

  const { data: usersData, isLoading } = useQuery({
    ...userControllerSearchUsersOptions({ query: { q: debouncedQuery, limit: 25 } }),
    enabled: debouncedQuery.length >= 1,
  });
  const { data: currentUser } = useQuery(userControllerGetProfileOptions());

  const users = useMemo(() => usersData ?? [], [usersData]);

  // Filter out excluded users
  const filteredUsers = users.filter((user) => {
    if (excludeCurrentUser && currentUser?.id === user.id) return false;
    if (excludeUserIds.includes(user.id)) return false;
    return true;
  });

  const handleChange = (_: React.SyntheticEvent, newValue: UserOption | UserOption[] | null) => {
    onChange(newValue);
  };

  // Shared props for both single and multiple modes
  // (server-side filtering — client-side filterOptions is a passthrough)
  const noOptionsText = debouncedQuery.length < 1 ? "Type to search..." : "No users found";

  const sharedProps = {
    options: filteredUsers,
    getOptionLabel: (user: UserOption) => user.displayName || user.username,
    getOptionDisabled,
    noOptionsText,
    onInputChange: (_e: React.SyntheticEvent, newInputValue: string) => setInputValue(newInputValue),
    filterOptions: (x: UserOption[]) => x,
    loading: isLoading,
    disabled,
    isOptionEqualToValue: (option: UserOption, val: UserOption) => option.id === val.id,
    renderInput: (params: React.ComponentProps<typeof TextField> & { InputProps: { endAdornment?: React.ReactNode } }) => (
      <TextField
        {...params}
        label={label}
        placeholder={placeholder}
        margin="normal"
        autoFocus={autoFocus}
        InputProps={{
          ...params.InputProps,
          endAdornment: (
            <>
              {isLoading ? <CircularProgress color="inherit" size={20} /> : null}
              {params.InputProps.endAdornment}
            </>
          ),
        }}
      />
    ),
    renderOption: (props: React.HTMLAttributes<HTMLLIElement> & { key?: string }, user: UserOption) => {
      const { key: _key, ...restProps } = props;
      return (
        <Box component="li" key={user.id} {...restProps} sx={{ display: 'flex', alignItems: 'center' }}>
          <UserAvatar user={user} size="small" />
          <Box sx={{ ml: 1, flex: 1 }}>
            <Typography variant="body2">
              {user.displayName || user.username}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              @{user.username}
            </Typography>
          </Box>
          {renderOptionExtra?.(user)}
        </Box>
      );
    },
  } as const;

  if (multiple) {
    return (
      <Autocomplete
        multiple
        {...sharedProps}
        value={(value as UserOption[]) || []}
        onChange={handleChange as (event: React.SyntheticEvent, value: UserOption[]) => void}
        renderTags={(tagValue, getTagProps) =>
          tagValue.map((user, index) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { key, ...chipProps } = getTagProps({ index });
            return (
              <Chip
                key={user.id}
                label={user.displayName || user.username}
                {...chipProps}
                avatar={<UserAvatar user={user} size="small" />}
              />
            );
          })
        }
      />
    );
  }

  return (
    <Autocomplete
      {...sharedProps}
      value={value as UserOption | null}
      onChange={handleChange as (event: React.SyntheticEvent, value: UserOption | null) => void}
    />
  );
};

export default UserSearchAutocomplete;
