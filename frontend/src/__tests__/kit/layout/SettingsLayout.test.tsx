import { useEffect, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen, within } from '@testing-library/react';
import { AppFrame, Button, SettingsLayout, TextField, type SettingsLayoutProps } from '../../../kit';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { WIDTH, mockViewport } from './matchMedia';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const mounts = { content: 0 };
beforeEach(() => {
  mounts.content = 0;
});

function Content(): ReactNode {
  const [name, setName] = useState('');
  useEffect(() => {
    mounts.content += 1;
  }, []);
  return <TextField label="Community name" value={name} onChange={setName} />;
}

function renderSettings(props: Partial<SettingsLayoutProps> = {}) {
  return renderWithKit(
    <AppFrame>
      <SettingsLayout
        title="Community settings"
        nav={<a href="#roles">Roles</a>}
        navLabel="Settings sections"
        {...props}
      >
        <Content />
      </SettingsLayout>
    </AppFrame>,
  );
}

describe.each([
  ['wide', WIDTH.wide],
  ['compact', WIDTH.compact],
])('SettingsLayout at %s', (_name, width) => {
  beforeEach(() => {
    mockViewport(width);
  });

  it('shows a labelled nav beside the main, in that order, with one main', () => {
    renderSettings();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const main = screen.getByRole('main');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(nav.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('titles the nav island and names the main with the title', () => {
    renderSettings();
    expect(within(screen.getByRole('navigation')).getByRole('heading', { name: 'Community settings' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Community settings' })).toBeInTheDocument();
  });

  it('has no Back button', () => {
    renderSettings({ onBack: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('renders the footer inside the main', () => {
    renderSettings({ footer: <Button variant="primary">Save changes</Button> });
    expect(within(screen.getByRole('main')).getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('leaves no footer element without one', () => {
    renderSettings();
    expect(screen.getByRole('main').querySelector('[data-slot="footer"]')).toBeNull();
  });
});

describe('SettingsLayout at phone', () => {
  beforeEach(() => {
    mockViewport(WIDTH.phone);
  });

  it('shows only the nav pane by default, under one main', () => {
    renderSettings();
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Community name' })).toBeNull();
    expect(screen.queryByRole('main', { name: 'Community settings' })).toBeNull();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('shows only the content pane with phonePane content, headed by a Back button', async () => {
    const onBack = vi.fn();
    const { user } = renderSettings({ phonePane: 'content', onBack });
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull();
    const main = screen.getByRole('main', { name: 'Community settings' });
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(within(main).getByRole('textbox', { name: 'Community name' })).toBeInTheDocument();
    await user.click(within(main).getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders the footer inside the content pane', () => {
    renderSettings({ phonePane: 'content', footer: <Button variant="primary">Save changes</Button> });
    expect(within(screen.getByRole('main')).getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('keeps the other pane hidden and inert', () => {
    renderSettings();
    const hiddenPane = document.querySelector('[inert]');
    expect(hiddenPane).toHaveAttribute('hidden');
    expect(hiddenPane?.querySelector('input')).not.toBeNull();
  });
});

describe('SettingsLayout across width changes', () => {
  it('keeps a typed value in the content, with no remount, through every range and pane', async () => {
    const viewport = mockViewport(WIDTH.wide);
    const { user } = renderSettings({ phonePane: 'nav' });
    await user.type(screen.getByRole('textbox', { name: 'Community name' }), 'Couch');
    viewport.setWidth(WIDTH.compact);
    viewport.setWidth(WIDTH.phone);
    expect(screen.queryByRole('textbox', { name: 'Community name' })).toBeNull();
    viewport.setWidth(WIDTH.wide);
    expect(screen.getByRole('textbox', { name: 'Community name' })).toHaveValue('Couch');
    expect(mounts.content).toBe(1);
  });
});
