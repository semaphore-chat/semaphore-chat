import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import AdminSetupStep from '../../components/Onboarding/AdminSetupStep';
import type { OnboardingData } from '../../components/Onboarding/OnboardingWizard';

const baseData: OnboardingData = {
  adminUsername: 'admin',
  adminPassword: 'password123',
  adminEmail: '',
  instanceName: 'My Instance',
  instanceDescription: '',
  defaultCommunityName: 'General',
  createDefaultCommunity: true,
  setupToken: 'setup-token',
};

function renderStep(overrides: Partial<OnboardingData> = {}) {
  const onNext = vi.fn();
  const { user } = renderWithProviders(
    <AdminSetupStep
      data={{ ...baseData, ...overrides }}
      updateData={vi.fn()}
      onNext={onNext}
      onBack={vi.fn()}
    />,
  );
  return { user, onNext };
}

describe('AdminSetupStep', () => {
  it('accepts a password of exactly 8 characters, the server minimum', async () => {
    const { user, onNext } = renderStep({ adminPassword: 'a'.repeat(8) });

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onNext).toHaveBeenCalled();
  });

  it('rejects a 7-character password before submitting', async () => {
    const { user, onNext } = renderStep({ adminPassword: 'a'.repeat(7) });

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      await screen.findByText('Password must be at least 8 characters'),
    ).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('rejects a password longer than the server maximum', async () => {
    const { user, onNext } = renderStep({ adminPassword: 'a'.repeat(129) });

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      await screen.findByText('Password must be at most 128 characters'),
    ).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('accepts a two-character username, like registration', async () => {
    const { user, onNext } = renderStep({ adminUsername: 'ab' });

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onNext).toHaveBeenCalled();
  });

  it('rejects a one-character username', async () => {
    const { user, onNext } = renderStep({ adminUsername: 'a' });

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      await screen.findByText('Username must be at least 2 characters'),
    ).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('rejects a username longer than 32 characters', async () => {
    const { user, onNext } = renderStep({ adminUsername: 'a'.repeat(33) });

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      await screen.findByText('Username must be at most 32 characters'),
    ).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('rejects characters the server refuses in a username', async () => {
    const { user, onNext } = renderStep({ adminUsername: 'admin user' });

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      await screen.findByText(
        'Username can only contain letters, numbers, underscores, and hyphens',
      ),
    ).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });
});
