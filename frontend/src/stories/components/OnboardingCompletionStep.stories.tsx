import React, { useState } from 'react';
import { http, HttpResponse } from 'msw';
import CompletionStep from '../../components/Onboarding/CompletionStep';
import type { OnboardingData } from '../../components/Onboarding/OnboardingWizard';
import { defineComponent } from '../fixtures/componentStory';
import { emptyUserScenario } from '../fixtures/scenarios';
import { clickButtonByText, useDriver, type DriverStep } from '../fixtures/edge/chat';

/**
 * The setup wizard's last step. By default (REQUIRE_SETUP_TOKEN) the operator
 * pastes the setup token the backend printed in its log; the server never
 * sends it.
 */
const baseData: OnboardingData = {
  adminUsername: 'admin',
  adminPassword: 'correct-horse-battery',
  adminEmail: 'admin@example.com',
  instanceName: 'Acme Chat',
  instanceDescription: 'Chat for the Acme team',
  defaultCommunityName: 'General',
  createDefaultCommunity: true,
  setupToken: '',
  setupTokenRequired: true,
};

const Drive: React.FC<{ steps: DriverStep[] }> = ({ steps }) => {
  useDriver(steps);
  return null;
};

const Step: React.FC<{ initial: Partial<OnboardingData>; steps?: DriverStep[] }> = ({
  initial,
  steps,
}) => {
  const [data, setData] = useState<OnboardingData>({ ...baseData, ...initial });
  return (
    <>
      <CompletionStep
        data={data}
        updateData={(patch) => setData((prev) => ({ ...prev, ...patch }))}
        onNext={() => {}}
        onBack={() => {}}
        onComplete={() => {}}
      />
      {steps && <Drive steps={steps} />}
    </>
  );
};

const story = (
  initial: Partial<OnboardingData>,
  options: Parameters<typeof defineComponent>[2] = {},
  steps?: DriverStep[],
) =>
  defineComponent(emptyUserScenario, () => <Step initial={initial} steps={steps} />, {
    maxWidth: 900,
    ...options,
  });

/** The token field is empty: Complete Setup stays disabled. */
export const TokenRequired = story({});

/** A token pasted from the backend log. */
export const TokenEntered = story({ setupToken: '3f8c2a1e-6b4d-4c9a-9e2f-7d1b5a0c8e43' });

/** REQUIRE_SETUP_TOKEN=false (or an older server): no token field, as before. */
export const TokenNotRequired = story({
  setupToken: 'sent-by-the-server',
  setupTokenRequired: false,
});

/** The pasted token doesn't match the one in the log (409 from the server). */
export const InvalidToken = story(
  { setupToken: 'not-the-right-token' },
  {
    extraHandlers: [
      http.post('/api/onboarding/setup', () =>
        HttpResponse.json(
          { statusCode: 409, message: 'Invalid setup token', error: 'Conflict' },
          { status: 409 },
        ),
      ),
    ],
  },
  [() => clickButtonByText(/complete setup/i)],
);

/** Any other failure keeps the server's message. */
export const OtherError = story(
  { setupToken: '3f8c2a1e-6b4d-4c9a-9e2f-7d1b5a0c8e43' },
  {
    extraHandlers: [
      http.post('/api/onboarding/setup', () =>
        HttpResponse.json(
          { statusCode: 409, message: 'Instance setup is not needed', error: 'Conflict' },
          { status: 409 },
        ),
      ),
    ],
  },
  [() => clickButtonByText(/complete setup/i)],
);
