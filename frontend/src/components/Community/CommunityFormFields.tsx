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
}

const CommunityFormFields: React.FC<CommunityFormFieldsProps> = ({
  name,
  description,
  onNameChange,
  onDescriptionChange,
  errors,
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
        // eslint-disable-next-line jsx-a11y/no-autofocus -- name is the first field of the create/edit community form; keeps the existing focus behaviour
        autoFocus
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
