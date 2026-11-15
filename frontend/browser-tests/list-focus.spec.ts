import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * The list focus host in real browsers, for what jsdom cannot show: Space and Enter activate a row once each
 * (a button clicks itself on keyup in Firefox; a link scrolls the page on Space), Space while letters are pending
 * presses nothing on keydown or keyup, the focus ring shows on keyboard focus only, and a focused row is scrolled
 * into view inside its list without scrolling the page.
 */
const VIEW = { width: 1024, height: 700 };
const PHONE = { width: 390, height: 844 };

const opened = (page: Page) => page.getByTestId('opened');
const focusedName = (page: Page) => page.evaluate(() => document.activeElement?.textContent ?? null);
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

test.describe('@keyboard', () => {
  test('button rows: Enter and Space open the focused row once each, and Space does not scroll the page', async ({ page }) => {
    await page.clock.install();
    await openStory(page, 'kit-list-focus--button-rows', VIEW);
    await page.getByRole('button', { name: 'aiko' }).focus();
    await page.keyboard.press('ArrowDown');
    expect(await focusedName(page)).toBe('gracie');
    await page.keyboard.press('Enter');
    await expect(opened(page)).toHaveText('Opened: gracie');
    await page.keyboard.press(' ');
    await expect(opened(page)).toHaveText('Opened: gracie, gracie');
    expect(await scrollY(page)).toBe(0);
  });

  test('Space while letters are pending is a letter: nothing is pressed, on keydown or keyup', async ({ page }) => {
    await page.clock.install();
    await openStory(page, 'kit-list-focus--button-rows', VIEW);
    await page.getByRole('button', { name: 'aiko' }).focus();
    await page.keyboard.type('dr');
    expect(await focusedName(page)).toBe('dropbear');
    await page.keyboard.press(' ');
    await page.keyboard.press('Enter');
    // Enter is not a letter: it opens the row; the Space before it opened nothing.
    await expect(opened(page)).toHaveText('Opened: dropbear');
    expect(await scrollY(page)).toBe(0);
    // Once the typeahead time has passed, Space presses again.
    await page.clock.fastForward(1000);
    await page.keyboard.press(' ');
    await expect(opened(page)).toHaveText('Opened: dropbear, dropbear');
  });

  test('link rows: Enter follows the link once; Space presses it once instead of scrolling', async ({ page }) => {
    await openStory(page, 'kit-list-focus--channel-list', VIEW);
    await page.evaluate(() => {
      const win = window as unknown as { hashes: string[] };
      win.hashes = [];
      window.addEventListener('hashchange', () => win.hashes.push(window.location.hash));
    });
    const hashes = () => page.evaluate(() => (window as unknown as { hashes: string[] }).hashes);
    const list = page.getByTestId('channel-list');
    await page.getByRole('link', { name: 'general' }).focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(hashes).toEqual(['#lfg']);
    await page.keyboard.press('ArrowDown');
    const before = await list.evaluate((element) => element.scrollTop);
    await page.keyboard.press(' ');
    await expect.poll(hashes).toEqual(['#lfg', '#clips']);
    expect(await list.evaluate((element) => element.scrollTop)).toBe(before);
    expect(await scrollY(page)).toBe(0);
    await expect(page.getByRole('link', { name: 'clips' })).toHaveAttribute('aria-current', 'page');
  });

  test('the focus ring shows on keyboard focus, not on a pointer press', async ({ page }) => {
    await openStory(page, 'kit-list-focus--channel-list', VIEW);
    const ring = (name: string) =>
      page.getByRole('link', { name }).evaluate((element) => ({
        focused: document.activeElement === element,
        visible: element.matches(':focus-visible'),
        outline: getComputedStyle(element, '::after').outlineStyle,
      }));
    await page.getByRole('link', { name: 'memes' }).click();
    expect(await ring('memes')).toEqual({ focused: true, visible: false, outline: 'none' });
    await page.keyboard.press('ArrowDown');
    expect(await ring('Game night')).toEqual({ focused: true, visible: true, outline: 'solid' });
  });

  test('the ring shows on the selected row too (the accent pill), not in the accent colour', async ({ page }) => {
    await openStory(page, 'kit-list-focus--channel-list-focused', VIEW);
    const general = page.getByRole('link', { name: 'general' });
    await expect(general).toBeFocused();
    const look = await general.evaluate((element) => ({
      visible: element.matches(':focus-visible'),
      outline: getComputedStyle(element, '::after').outlineStyle,
      ring: getComputedStyle(element, '::after').outlineColor,
      pill: getComputedStyle(element.parentElement as Element).backgroundColor,
    }));
    expect(look).toMatchObject({ visible: true, outline: 'solid' });
    expect(look.ring).not.toBe(look.pill);
  });

  test('a click that focuses nothing (as Safari does) still leaves focus on the row, with no ring', async ({ page }) => {
    await openStory(page, 'kit-list-focus--channel-list', VIEW);
    // Safari does not focus a link or button on click; cancelling mousedown does the same in every engine.
    await page.evaluate(() => {
      document.addEventListener('mousedown', (event) => {
        if ((event.target as Element).closest('a, button')) event.preventDefault();
      }, true);
    });
    const memes = page.getByRole('link', { name: 'memes' });
    await memes.click();
    await expect(memes).toBeFocused();
    expect(await memes.evaluate((element) => element.matches(':focus-visible'))).toBe(false);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('link', { name: 'Game night' })).toBeFocused();
  });

  test('trailing controls: not Tab stops; Right reaches them from the row and Left goes back', async ({ page }) => {
    await openStory(page, 'kit-list-focus--channel-list', VIEW);
    await page.getByRole('link', { name: 'general' }).focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('button', { name: 'Mute lfg' })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('link', { name: 'lfg' })).toBeFocused();
    // One Tab leaves the list (past every row and trailing control) for the button after it.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Add channel' })).toBeFocused();
    // Back in: the Tab stop went back to the selected row when focus left (focusOut).
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('link', { name: 'general' })).toBeFocused();
  });
});

test('a long list: End and Home scroll the focused row into view inside the list, not the page', async ({ page }) => {
  await openStory(page, 'kit-list-focus--channel-list', PHONE);
  const list = page.getByTestId('channel-list');
  const inView = (name: string) =>
    page.evaluate((target) => {
      const box = document.querySelector('[data-testid="channel-list"]')?.getBoundingClientRect();
      const row = Array.from(document.querySelectorAll('a')).find((a) => a.textContent === target)?.getBoundingClientRect();
      return !!box && !!row && row.top >= box.top - 1 && row.bottom <= box.bottom + 1;
    }, name);
  await page.getByRole('link', { name: 'general' }).focus();
  const pageBefore = await scrollY(page);
  expect(await inView('afk')).toBe(false);
  await page.keyboard.press('End');
  await expect(page.getByRole('link', { name: 'afk' })).toBeFocused();
  expect(await inView('afk')).toBe(true);
  expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Home');
  expect(await inView('general')).toBe(true);
  expect(await list.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await scrollY(page)).toBe(pageBefore);
});

test('the selection set from outside moves the pill and the Tab stop; focus stays on the button', async ({ page }) => {
  await openStory(page, 'kit-list-focus--selection-from-outside', VIEW);
  const go = page.getByRole('button', { name: 'Go to #memes' });
  await go.click();
  await expect(page.getByRole('link', { name: 'memes' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'memes' })).toHaveAttribute('tabindex', '0');
  await expect(page.getByRole('link', { name: 'clips' })).toHaveAttribute('tabindex', '-1');
  await expect(go).toBeFocused();
  await page.getByRole('button', { name: 'Clear' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'memes' })).toBeFocused();
});

test.describe('@keyboard', () => {
  test('leave the list, change the selection from outside, Tab back: focus lands on the newly selected row', async ({ page }) => {
    await openStory(page, 'kit-list-focus--selection-from-outside', VIEW);
    await page.getByRole('link', { name: 'clips' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('link', { name: 'memes' })).toBeFocused();
    // Out of the list, backwards, onto Clear; then a selection from outside.
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Clear' })).toBeFocused();
    await page.getByRole('button', { name: 'Go to #general' }).click();
    await expect(page.getByRole('link', { name: 'general' })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: 'Clear' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'general' })).toBeFocused();
  });
});
