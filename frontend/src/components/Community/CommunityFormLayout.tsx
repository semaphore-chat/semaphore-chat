import React from "react";
import {
  Box,
  Typography,
  Button,
  Paper,
  IconButton,
  CircularProgress,
  Alert,
  styled,
} from "@mui/material";
import { ArrowBack } from "@mui/icons-material";

const Root = styled(Box)(({ theme }) => ({
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  minHeight: "var(--full-dvh)",
  padding: theme.spacing(2),
  background: theme.palette.background.ground,
}));

const FormContainer = styled(Paper)(({ theme }) => ({
  maxWidth: 600,
  width: "100%",
  padding: theme.spacing(4),
  borderRadius: theme.spacing(2),
}));

const HeaderSection = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  marginBottom: theme.spacing(3),
  gap: theme.spacing(2),
}));

const ActionButtons = styled(Box)(({ theme }) => ({
  display: "flex",
  gap: theme.spacing(2),
  justifyContent: "flex-end",
  marginTop: theme.spacing(3),
}));

interface CommunityFormLayoutProps {
  title: string;
  onGoBack: () => void;
  onSubmit: (event: React.FormEvent) => void;
  error?: unknown;
  errorMessage: string;
  isLoading: boolean;
  isFormValid: boolean;
  submitButtonText: string;
  loadingText: string;
  children: React.ReactNode;
}

const CommunityFormLayout: React.FC<CommunityFormLayoutProps> = ({
  title,
  onGoBack,
  onSubmit,
  error,
  errorMessage,
  isLoading,
  isFormValid,
  submitButtonText,
  loadingText,
  children,
}) => {
  return (
    <Root>
      <FormContainer>
        <HeaderSection>
          <IconButton onClick={onGoBack} edge="start">
            <ArrowBack />
          </IconButton>
          <Typography variant="h4" component="h1" fontWeight={600}>
            {title}
          </Typography>
        </HeaderSection>

        {Boolean(error) && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {errorMessage}
          </Alert>
        )}

        <form onSubmit={onSubmit}>
          {children}
          
          <ActionButtons>
            <Button
              variant="outlined"
              onClick={onGoBack}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={isLoading || !isFormValid}
              startIcon={isLoading && <CircularProgress size={16} />}
            >
              {isLoading ? loadingText : submitButtonText}
            </Button>
          </ActionButtons>
        </form>
      </FormContainer>
    </Root>
  );
};

export default CommunityFormLayout;
