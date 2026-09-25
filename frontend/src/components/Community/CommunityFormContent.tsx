import React from "react";
import { Box, styled } from "@mui/material";
import CommunityBannerUpload from "./CommunityBannerUpload";
import CommunityAvatarUpload from "./CommunityAvatarUpload";
import CommunityFormFields, { type FormErrors } from "./CommunityFormFields";

const FormContent = styled(Box)(({ theme }) => ({
  display: "flex",
  flexDirection: "column",
  gap: theme.spacing(3),
}));

interface CommunityFormContentProps {
  formData: {
    name: string;
    description: string;
  };
  previewUrls: {
    avatar: string | null;
    banner: string | null;
  };
  formErrors: FormErrors;
  onNameChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDescriptionChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAvatarChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onBannerChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  /** Focus the name field on mount (the create page; not the edit page). */
  autoFocusName?: boolean;
}

const CommunityFormContent: React.FC<CommunityFormContentProps> = ({
  formData,
  previewUrls,
  formErrors,
  onNameChange,
  onDescriptionChange,
  onAvatarChange,
  onBannerChange,
  autoFocusName,
}) => {
  return (
    <FormContent>
      <CommunityBannerUpload
        previewUrl={previewUrls.banner}
        onChange={onBannerChange}
      />

      <CommunityAvatarUpload
        previewUrl={previewUrls.avatar}
        communityName={formData.name}
        onChange={onAvatarChange}
      />

      <CommunityFormFields
        name={formData.name}
        description={formData.description}
        onNameChange={onNameChange}
        onDescriptionChange={onDescriptionChange}
        errors={formErrors}
        autoFocusName={autoFocusName}
      />
    </FormContent>
  );
};

export default CommunityFormContent;
