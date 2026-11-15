/**
 * The sign-out controls, idle and while a sign-out runs. The logout request
 * hangs in the "signing out" stories, so the busy state stays on screen: the
 * phone profile panel's row is disabled and reads "Logging out…", and the
 * desktop rail's confirm dialog shows its loading button.
 */
import React from 'react';
import { MobileProfilePanel } from '../../components/Mobile/Panels/MobileProfilePanel';
import { MobileNavigationProvider } from '../../components/Mobile/Navigation/MobileNavigationContext';
import { defineComponent } from '../fixtures/componentStory';
import { defineScreen } from '../fixtures/screenStory';
import { bigCommunityScenario } from '../fixtures/scenarios';
import { withHangingEndpoint } from '../fixtures/edge/states';
import { useDriver, type DriverStep } from '../fixtures/edge/chat';
import { findButtonByText, findMenuItemByText, findRoleButtonContaining } from '../fixtures/domQueries';

const hangLogout = [withHangingEndpoint('post', '/api/auth/logout')];

/** Click what `find` returns, once it exists. */
function click(find: () => HTMLElement | null): DriverStep {
  return () => {
    const el = find();
    if (!el) return false;
    el.click();
    return true;
  };
}

const TapPhoneLogout: React.FC = () => {
  useDriver([click(() => findRoleButtonContaining('Logout'))]);
  return null;
};

const OpenRailLogOutConfirm: React.FC = () => {
  useDriver([
    click(() => document.querySelector<HTMLElement>('[aria-label="Account menu"]')),
    click(() => findMenuItemByText(/log out/i)),
  ]);
  return null;
};

const ConfirmRailLogOut: React.FC = () => {
  useDriver([
    click(() => document.querySelector<HTMLElement>('[aria-label="Account menu"]')),
    click(() => findMenuItemByText(/log out/i)),
    click(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog ? findButtonByText(/^log out$/i) : null;
    }),
  ]);
  return null;
};

const phonePanel = () => (
  <MobileNavigationProvider>
    <MobileProfilePanel />
  </MobileNavigationProvider>
);

/** The phone profile panel with its Logout row, idle. */
export const PhoneProfileLogout = defineComponent(bigCommunityScenario, phonePanel, { maxWidth: false });

/** The phone row while the logout call runs: disabled, busy, "Logging out…"; another tap does nothing. */
export const PhoneProfileSigningOut = defineComponent(bigCommunityScenario, () => (
  <>
    {phonePanel()}
    <TapPhoneLogout />
  </>
), { maxWidth: false, extraHandlers: hangLogout });

/** Desktop: the rail's "Log out?" confirm, idle. The rail is desktop-only: phone and tablet render the mobile shell. */
export const RailLogOutConfirm = defineScreen(bigCommunityScenario, '/', {
  overlay: <OpenRailLogOutConfirm />,
});

/** Desktop: the confirm dialog after "Log out" while the logout call runs: the button shows it is busy. */
export const RailSigningOut = defineScreen(bigCommunityScenario, '/', {
  extraHandlers: hangLogout,
  overlay: <ConfirmRailLogOut />,
});
