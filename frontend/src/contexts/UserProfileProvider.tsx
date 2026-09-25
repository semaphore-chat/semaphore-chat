import React, { useState, useCallback, ReactNode } from "react";
import { UserProfileModal } from "../components/Profile";
import { UserProfileContext } from "./UserProfileContext";

interface UserProfileProviderProps {
  children: ReactNode;
}

export const UserProfileProvider: React.FC<UserProfileProviderProps> = ({ children }) => {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const openProfile = useCallback((userId: string) => {
    setSelectedUserId(userId);
    setIsOpen(true);
  }, []);

  const closeProfile = useCallback(() => {
    setIsOpen(false);
    // Delay clearing userId to allow exit animation
    setTimeout(() => setSelectedUserId(null), 200);
  }, []);

  return (
    <UserProfileContext.Provider value={{ openProfile, closeProfile }}>
      {children}
      <UserProfileModal
        userId={selectedUserId}
        open={isOpen}
        onClose={closeProfile}
      />
    </UserProfileContext.Provider>
  );
};
