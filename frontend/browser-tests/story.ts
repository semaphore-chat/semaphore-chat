import type { Page } from '@playwright/test';

export interface StoryView {
  width: number;
  height: number;
  /** Ladle's theme control; the kit stories set their own mode, so this is rarely needed. */
  mode?: 'light' | 'dark';
}

/**
 * Opens a Ladle story in preview mode (the URL form the screenshot tools use: `/?story=<id>&mode=preview`)
 * at the given viewport, and waits until the story has rendered: Ladle's loaded marker is set, its loading
 * spinner is gone, something inside `#ladle-root` has a size, and the web fonts are in. An error thrown while
 * loading fails the call with that error instead of a timeout further on.
 */
export async function openStory(page: Page, id: string, { width, height, mode }: StoryView): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width, height });
  const theme = mode ? `&theme=${mode}` : '';
  await page.goto(`/?story=${encodeURIComponent(id)}&mode=preview${theme}`);
  try {
    await page.waitForFunction(
      () => {
        const root = document.getElementById('ladle-root');
        if (!document.documentElement.hasAttribute('data-storyloaded') || !root || root.querySelector('.ladle-ring-wrapper')) {
          return false;
        }
        if (/Story not found/.test(root.textContent ?? '')) {
          return true;
        }
        return Array.from(root.querySelectorAll('*')).some((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      },
      null,
      { timeout: 45_000 },
    );
  } catch (error) {
    throw new Error(`story "${id}" did not render${errors.length ? `: ${errors.join('; ')}` : ''}`, { cause: error });
  }
  if (await page.getByText('Story not found').count()) {
    throw new Error(`Ladle has no story "${id}"`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}
