/**
 * "Rendered" heuristic for a Ladle story: resolves once the DOM has gone
 * `quietMs` without a mutation (data arrived, lazy routes mounted, virtual
 * lists measured), or after `maxMs`. A fixed sleep after `networkidle` is not
 * enough under parallel load — MSW responses and lazy chunks land after it.
 */
import type { Page } from 'playwright-core';

export async function waitForDomQuiet(page: Page, quietMs = 500, maxMs = 8000): Promise<void> {
  await page.evaluate(
    ({ quietMs, maxMs }) =>
      new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        const finish = () => {
          observer.disconnect();
          clearTimeout(cap);
          resolve();
        };
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(finish, quietMs);
        });
        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
        timer = setTimeout(finish, quietMs);
        const cap = setTimeout(finish, maxMs);
      }),
    { quietMs, maxMs },
  );
}
