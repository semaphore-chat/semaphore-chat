import React from 'react';
import { MobileLayout } from '../components/Mobile/MobileLayout';
import { TabletLayout } from '../components/Mobile/Tablet/TabletLayout';
import { DesktopLayout } from '../components/Desktop/DesktopLayout';
import { useResponsive } from '../hooks/useResponsive';
import type { User } from '../types/auth.type';

interface ClassicShellProps {
  userData: User | undefined;
}

/** The old shell: the phone, tablet or desktop layout, picked by the old breakpoints. */
export const ClassicShell: React.FC<ClassicShellProps> = ({ userData }) => {
  const { isMobile, isTablet } = useResponsive();
  return isMobile ? <MobileLayout /> : isTablet ? <TabletLayout /> : <DesktopLayout userData={userData} />;
};
