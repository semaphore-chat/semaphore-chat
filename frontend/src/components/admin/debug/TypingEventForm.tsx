import React from "react";
import { Stack, Switch, FormControlLabel } from "@mui/material";
import UserSearchAutocomplete, {
  type UserOption,
} from "../../Common/UserSearchAutocomplete";

interface TypingEventFormProps {
  value: { user: UserOption | null; isTyping: boolean };
  onChange: (value: { user: UserOption | null; isTyping: boolean }) => void;
}

const TypingEventForm: React.FC<TypingEventFormProps> = ({
  value,
  onChange,
}) => {
  return (
    <Stack spacing={2}>
      <UserSearchAutocomplete
        value={value.user}
        onChange={(u) =>
          onChange({ ...value, user: u as UserOption | null })
        }
        label="User (who is typing)"
        placeholder="Type a username to search..."
        excludeCurrentUser={false}
      />
      <FormControlLabel
        control={
          <Switch
            checked={value.isTyping}
            onChange={(e) =>
              onChange({ ...value, isTyping: e.target.checked })
            }
          />
        }
        label="Is Typing"
      />
    </Stack>
  );
};

export default TypingEventForm;
