/**
 * Plain DOM query/mutation helpers used by `interactions.tsx`'s
 * `ClickOnMount`-family components. Split into their own file (no React
 * components here) so that file can stay component-only — mixing the two
 * trips `react-refresh/only-export-components`.
 */

/** Find the enclosing `<button>` for a MUI icon rendered with `data-testid="<IconName>"`. */
export function findButtonByIconTestId(testId: string): HTMLElement | null {
  const icon = document.querySelector(`[data-testid="${testId}"]`);
  return (icon?.closest('button') as HTMLElement | null) ?? null;
}

/** Find a `<button>` whose visible text matches `pattern`. */
export function findButtonByText(pattern: RegExp): HTMLElement | null {
  const buttons = Array.from(document.querySelectorAll('button'));
  return buttons.find((b) => pattern.test(b.textContent ?? '')) ?? null;
}

/**
 * Find a MUI `<MenuItem>` (renders `role="menuitem"`, portaled to
 * `document.body` while its `<Menu>` is open) whose visible text matches
 * `pattern`.
 */
export function findMenuItemByText(pattern: RegExp): HTMLElement | null {
  const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
  return (items.find((el) => pattern.test(el.textContent ?? '')) as HTMLElement | undefined) ?? null;
}

/**
 * Simulate picking a file via the hidden `<input type="file">` MessageInput
 * renders (no drag-and-drop event faking needed — React's file input just
 * listens for a native `change` event once `.files` is set via DataTransfer).
 */
export function attachFakeFile(filename: string, type: string, content = 'fake file contents'): boolean {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (!input) return false;
  const file = new File([content], filename, { type });
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/**
 * Set a controlled `<textarea>`'s value and fire the native `input` event
 * React listens for (the plain `element.value = ...` assignment alone is
 * swallowed by React's controlled-input tracking, hence the native setter).
 */
export function typeIntoTextarea(text: string): boolean {
  const textarea = document.querySelector('textarea') as HTMLTextAreaElement | null;
  if (!textarea) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, text);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/**
 * Find a `role="button"` element (a MUI `ListItemButton` row, e.g. a DM list
 * entry) whose visible text contains `text`. Rows inside hidden layers (the
 * phone's kept-alive list screen once a chat is open: `inert`/`aria-hidden`)
 * don't count, so a re-running driver can't click them a second time.
 */
export function findRoleButtonContaining(text: string): HTMLElement | null {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[role="button"]'));
  return (
    rows.find(
      (el) => !el.closest('[inert], [aria-hidden="true"]') && (el.textContent ?? '').includes(text),
    ) ?? null
  );
}
