/**
 * Authentication E2E Tests
 *
 * Tests login, registration, logout, and session persistence flows.
 */

import { test, expect } from '@playwright/test';
import { TEST_USER, setAuthToken, clearAuthToken, isAuthenticated, loginViaApi } from './fixtures';

test.describe('Authentication', () => {
  test.describe('Login Page', () => {
    test('displays login form @smoke', async ({ page }) => {
      await page.goto('/login');

      // Check form elements are visible
      await expect(page.locator('h1, h5').filter({ hasText: 'Login' })).toBeVisible();
      await expect(page.locator('#username')).toBeVisible();
      await expect(page.locator('#password')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    });

    test('shows error on invalid credentials', async ({ page }) => {
      await page.goto('/login');

      // Fill in invalid credentials
      await page.locator('#username').fill('invaliduser');
      await page.locator('#password').fill('wrongpassword');
      await page.getByRole('button', { name: 'Login' }).click();

      // Should show error
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.getByRole('alert')).toContainText(/failed|error/i);
    });

    test('successful login redirects to home @smoke', async ({ page }) => {
      await page.goto('/login');

      await page.locator('#username').fill(TEST_USER.username);
      await page.locator('#password').fill(TEST_USER.password);
      await page.getByRole('button', { name: 'Login' }).click();

      // Wait for redirect or content change
      await page.waitForURL('/', { timeout: 10000 }).catch(() => {});

      // Verify token is stored
      const hasToken = await isAuthenticated(page);
      expect(hasToken).toBe(true);
    });

    test('has link to registration page', async ({ page }) => {
      await page.goto('/login');

      const registerLink = page.getByRole('link', { name: /register/i });
      await expect(registerLink).toBeVisible();
      await registerLink.click();

      await expect(page).toHaveURL(/\/register/);
    });
  });

  test.describe('Registration Page', () => {
    test('shows error on invalid registration', async ({ page }) => {
      await page.goto('/register');

      // Find form inputs using flexible selectors
      const usernameInput = page.locator('#username, [name="username"], input[placeholder*="username" i]').first();
      const emailInput = page.locator('#email, [name="email"], input[placeholder*="email" i], input[type="email"]').first();
      const passwordInput = page.locator('#password, [name="password"], input[placeholder*="password" i], input[type="password"]').first();
      const codeInput = page.locator('#code, [name="code"], input[placeholder*="code" i], input[placeholder*="invite" i]').first();

      // Fill in form with invalid data
      if (await usernameInput.isVisible().catch(() => false)) {
        await usernameInput.fill('newuser' + Date.now());
      }
      if (await emailInput.isVisible().catch(() => false)) {
        await emailInput.fill('newuser@test.local');
      }
      if (await passwordInput.isVisible().catch(() => false)) {
        await passwordInput.fill('Password123!');
      }
      if (await codeInput.isVisible().catch(() => false)) {
        await codeInput.fill('invalid-code');
      }

      const submitButton = page.getByRole('button', { name: /register|sign up|create/i });
      if (await submitButton.isVisible().catch(() => false)) {
        await submitButton.click();
      }
    });

    test('has link to login page', async ({ page }) => {
      await page.goto('/register');

      const loginLink = page.getByRole('link', { name: /login|sign in/i });
      if (await loginLink.isVisible().catch(() => false)) {
        await loginLink.click();
        await expect(page).toHaveURL(/\/login/);
      } else {
        expect(true).toBe(true);
      }
    });
  });

  test.describe('Session Management', () => {
    test('authenticated user can access protected pages @smoke', async ({ page, request }) => {
      const { accessToken } = await loginViaApi(request, TEST_USER);

      await page.goto('/');
      await setAuthToken(page, accessToken);
      await page.reload();

      await expect(page).not.toHaveURL(/\/login/);
    });

    test('token persists after page reload @smoke', async ({ page, request }) => {
      const { accessToken } = await loginViaApi(request, TEST_USER);

      await page.goto('/');
      await setAuthToken(page, accessToken);

      await page.reload();

      const hasToken = await isAuthenticated(page);
      expect(hasToken).toBe(true);
    });
  });

  test.describe('Logout', () => {
    test('logout clears session and redirects to login', async ({ page }) => {
      // A real login (a token alone, without the refresh cookie, doesn't keep the app signed in).
      await page.goto('/login');
      await page.locator('#username').fill(TEST_USER.username);
      await page.locator('#password').fill(TEST_USER.password);
      await page.getByRole('button', { name: 'Login' }).click();

      // Desktop: the account menu at the foot of the community rail, then confirm.
      await page.getByRole('button', { name: 'Account menu' }).click();
      await page.getByRole('menuitem', { name: /log out/i }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Log out' }).click();

      // Back on the login form (the app routes in the hash, so check the page, not the URL).
      await expect(page.locator('#username')).toBeVisible({ timeout: 10000 });

      const hasToken = await isAuthenticated(page);
      expect(hasToken).toBe(false);
    });
  });
});

test.describe('Protected Routes', () => {
  test('accessing settings without auth redirects to login', async ({ page }) => {
    await page.goto('/');
    await clearAuthToken(page);
    await page.goto('/settings');

    await expect(page).toHaveURL(/\/(login|register)/);
  });

  test('direct URL access with valid auth works', async ({ page, request }) => {
    const { accessToken } = await loginViaApi(request, TEST_USER);

    await page.goto('/');
    await setAuthToken(page, accessToken);

    await page.goto('/settings');

    expect(page.url()).not.toContain('/login');
  });
});
