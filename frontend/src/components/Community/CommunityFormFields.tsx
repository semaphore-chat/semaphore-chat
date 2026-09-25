import React from "react";
import { Box, TextField, styled } from "@mui/material";

const FormFields = styled(Box)(({ theme }) => ({
  display: "flex",
  flexDirection: "column",
  gap: theme.spacing(3),
}));

export interface FormErrors {
  name?: string;
  description?: string;
}

interface CommunityFormFieldsProps {
  name: string;
  description: string;
  onNameChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDescriptionChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  errors: FormErrors;
  /** Focus the name field on mount (the create page; not the edit page). */
  autoFocusName?: boolean;
}

const CommunityFormFields: React.FC<CommunityFormFieldsProps> = ({
  name,
  description,
  onNameChange,
  onDescriptionChange,
  errors,
  autoFocusName = false,
}) => {
  return (
    <FormFields>
      <TextField
        label="Community Name"
        variant="outlined"
        value={name}
        onChange={onNameChange}
        error={Boolean(errors.name)}
        helperText={errors.name}
        required
        fullWidth
        // eslint-disable-next-line jsx-a11y/no-autofocus -- only the create page asks for it: the user just chose to create a community
        autoFocus={autoFocusName}
      />

      <TextField
        label="Description"
        variant="outlined"
        value={description}
        onChange={onDescriptionChange}
        multiline
        rows={3}
        fullWidth
        placeholder="Tell people what your community is about..."
      />
    </FormFields>
  );
};

export default CommunityFormFields;
