import React from "react";
import { TextField } from "@mui/material";

interface GenericEventFormProps {
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}

const GenericEventForm: React.FC<GenericEventFormProps> = ({
  value,
  onChange,
  error,
}) => {
  return (
    <TextField
      label="Event Payload (JSON)"
      multiline
      minRows={4}
      maxRows={12}
      fullWidth
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={!!error}
      helperText={error || "Enter a valid JSON object for the event payload"}
      slotProps={{
        input: {
          sx: { fontFamily: "monospace", fontSize: 13 },
        },
      }}
    />
  );
};

export default GenericEventForm;
