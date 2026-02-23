import React, { useState } from "react";
import { logger } from "../utils/logger";
import {
  Box,
  Button,
  TextField,
  Typography,
  Alert,
  CircularProgress,
} from "@mui/material";
import { styled } from "@mui/system";
import { useNavigate, Link } from "react-router-dom";
import { setAccessToken } from "../utils/tokenService";
import { useMutation } from "@tanstack/react-query";
import { userControllerRegisterMutation, authControllerLoginMutation } from "../api-client/@tanstack/react-query.gen";

const FormContainer = styled(Box)({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "16px",
});

const FormBox = styled(Box)({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "32px",
  borderRadius: "8px",
  boxShadow: "0px 4px 10px rgba(0, 0, 0, 0.1)",
  width: "100%",
  maxWidth: "400px",
});

const getErrorMessage = (err: unknown): string => {
  const msg = (err as Record<string, unknown>)?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  if (typeof msg === 'string') return msg;
  return 'Registration failed. Please try again.';
};

const RegisterPage: React.FC = () => {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const { mutateAsync: register, isPending: isLoading, error } = useMutation(userControllerRegisterMutation());
  const { mutateAsync: login, isPending: isLoginLoading } = useMutation(authControllerLoginMutation());
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await register({ body: { username, email, password, code } });
      const response = await login({ body: { username, password } });
      setAccessToken(response.accessToken);
      if (response.refreshToken) {
        localStorage.setItem('refreshToken', response.refreshToken);
      }
      navigate("/");
    } catch (err) {
      logger.error("Registration failed:", err);
    }
  };

  return (
    <FormContainer>
      <FormBox
        as="form"
        onSubmit={handleSubmit}
        aria-labelledby="register-title"
      >
        <Typography
          id="register-title"
          variant="h5"
          component="h1"
          sx={{ marginBottom: 2 }}
        >
          Register
        </Typography>
        {error && (
          <Alert
            severity="error"
            sx={{ width: "100%", marginBottom: 2 }}
            role="alert"
          >
            {getErrorMessage(error)}
          </Alert>
        )}
        <TextField
          id="username"
          label="Username"
          variant="outlined"
          fullWidth
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          sx={{ marginBottom: 2 }}
          required
        />
        <TextField
          id="email"
          label="Email"
          type="email"
          variant="outlined"
          fullWidth
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          sx={{ marginBottom: 2 }}
          required
        />
        <TextField
          id="password"
          label="Password"
          type="password"
          variant="outlined"
          fullWidth
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          sx={{ marginBottom: 2 }}
          required
          helperText="Must be at least 8 characters"
        />
        <TextField
          id="code"
          label="Code"
          variant="outlined"
          fullWidth
          value={code}
          onChange={(e) => setCode(e.target.value)}
          sx={{ marginBottom: 2 }}
          required
        />
        <Button
          type="submit"
          variant="contained"
          color="primary"
          fullWidth
          disabled={isLoading}
        >
          {isLoading || isLoginLoading ? (
            <CircularProgress size={24} color="inherit" />
          ) : (
            "Register"
          )}
        </Button>
        <Typography variant="body2" color="textSecondary" sx={{ marginTop: 2 }}>
          Already have an account?{" "}
          <Link to="/login" aria-label="Go to login page">
            Login here
          </Link>
        </Typography>
      </FormBox>
    </FormContainer>
  );
};

export default RegisterPage;
