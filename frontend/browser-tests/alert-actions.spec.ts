import { expect, test } from '@playwright/test';
import { openStory } from './story.ts';

/** Alert with two actions at a phone width and long labels: the buttons wrap onto lines and nothing overflows. */
test('alert with long action labels wraps inside the alert, at phone width', async ({ page }) => {
  await openStory(page, 'kit-alert--secondary-action-long', { width: 320, height: 700 });
  const measured = await page.evaluate(() => {
    const alert = document.querySelector('[role="status"], [role="alert"]') as HTMLElement;
    const box = alert.getBoundingClientRect();
    const buttons = Array.from(alert.querySelectorAll('button')).map((button) => button.getBoundingClientRect());
    return {
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      alertOverflow: alert.scrollWidth > alert.clientWidth,
      inside: buttons.every((rect) => rect.left >= box.left - 1 && rect.right <= box.right + 1),
      lines: new Set(buttons.map((rect) => Math.round(rect.top))).size,
      count: buttons.length,
    };
  });
  expect(measured).toMatchObject({ pageOverflow: false, alertOverflow: false, inside: true, count: 2 });
  expect(measured.lines).toBe(2);
});

test('one action label longer than the row is cut with an ellipsis, inside the alert', async ({ page }) => {
  await openStory(page, 'kit-alert--secondary-action-one-long', { width: 320, height: 700 });
  const measured = await page.evaluate(() => {
    const alert = document.querySelector('[role="status"], [role="alert"]') as HTMLElement;
    const box = alert.getBoundingClientRect();
    const button = alert.querySelector('button') as HTMLElement;
    const rect = button.getBoundingClientRect();
    const label = button.querySelector('span:not([class*="Icon"])') as HTMLElement;
    return {
      inside: rect.left >= box.left - 1 && rect.right <= box.right + 1,
      cut: Array.from(button.querySelectorAll('span')).some((span) => span.scrollWidth > span.clientWidth),
      overflow: alert.scrollWidth > alert.clientWidth,
      label: !!label,
    };
  });
  expect(measured).toMatchObject({ inside: true, cut: true, overflow: false });
});
