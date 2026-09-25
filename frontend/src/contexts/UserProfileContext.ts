/**
 * UserProfileContext
 *
 * Context for managing user profile modal state.
 * Allows any component to trigger viewing a user's profile.
 *
 * The provider component (which also renders the modal) lives in
 * UserProfileProvider.tsx so each module only exports components or
 * non-components (React Fast Refresh).
 */

import { createContext, useContext } from "react";

export interface UserProfileContextType {
  openProfile: (userId: string) => void;
  closeProfile: () => void;
}

export const UserProfileContext = createContext<UserProfileContextType | null>(null);

export const useUserProfile = () => {
  const context = useContext(UserProfileContext);
  if (!context) {
    throw new Error("useUserProfile must be used within a UserProfileProvider");
  }
  return context;
};
