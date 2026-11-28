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

const settings = (props: Partial<SettingsLayoutProps> = {}) => (
    <AppFrame>
      <SettingsLayout
        title="Community settings"
        nav={<a href="#roles">Roles</a>}
        navLabel="Settings sections"
        onBack={() => undefined}
        {...props}
      >
        <Content />
      </SettingsLayout>
    </AppFrame>
);

const renderSettings = (props: Partial<SettingsLayoutProps> = {}) => renderWithKit(settings(props));

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
    await viewport.setWidth(WIDTH.compact);
    await viewport.setWidth(WIDTH.phone);
    expect(screen.queryByRole('textbox', { name: 'Community name' })).toBeNull();
    await viewport.setWidth(WIDTH.wide);
    expect(screen.getByRole('textbox', { name: 'Community name' })).toHaveValue('Couch');
    expect(mounts.content).toBe(1);
  });
});

describe('SettingsLayout: the phone flow', () => {
  beforeEach(() => {
    mockViewport(WIDTH.phone);
  });

  it.each(['nav', 'content'] as const)('has exactly one h1 and one main with the %s pane shown', (phonePane) => {
    renderSettings({ phonePane });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('moves focus into the content pane when it replaces the nav', async () => {
    const view = renderSettings({ phonePane: 'nav' });
    await view.user.click(screen.getByRole('link', { name: 'Roles' }));
    expect(screen.getByRole('link', { name: 'Roles' })).toHaveFocus();
    view.rerender(settings({ phonePane: 'content' }));
    expect(screen.getByRole('main', { name: 'Community settings' }).parentElement).toHaveFocus();
  });

  it('moves focus back into the nav pane when Back returns to it', async () => {
    const view = renderSettings({ phonePane: 'content' });
    await view.user.click(screen.getByRole('textbox', { name: 'Community name' }));
    view.rerender(settings({ phonePane: 'nav' }));
    expect(screen.getByRole('navigation', { name: 'Settings sections' }).parentElement).toHaveFocus();
  });

  it('moves focus into the shown pane when the width crosses into the phone range', async () => {
    const viewport = mockViewport(WIDTH.compact);
    const view = renderSettings({ phonePane: 'content' });
    await view.user.click(screen.getByRole('link', { name: 'Roles' }));
    await viewport.setWidth(WIDTH.phone);
    expect(screen.getByRole('main', { name: 'Community settings' }).parentElement).toHaveFocus();
  });

  it('hides the other pane with hidden and inert', () => {
    renderSettings({ phonePane: 'nav' });
    const hidden = document.querySelectorAll('[inert]');
    expect(hidden).toHaveLength(1);
    expect(hidden[0]).toHaveAttribute('hidden');
  });
});

describe('SettingsLayout: a footer that is not there', () => {
  it.each([null, false, ''])('footer=%j leaves no element', (footer) => {
    mockViewport(WIDTH.wide);
    renderSettings({ footer });
    expect(document.querySelector('[data-slot="footer"]')).toBeNull();
  });
});

describe("SettingsLayout: the shell's pieces (dock, nav footer, call bar)", () => {
  const pieces = {
    dock: <div data-testid="dock">dock</div>,
    navFooter: <p>your card</p>,
    callBar: <button type="button">Deafen</button>,
  };

  it.each([
    ['wide', WIDTH.wide],
    ['compact', WIDTH.compact],
  ])('at %s: the dock, the nav (its footer inside), the call bar, then the content, in that order', (_name, width) => {
    mockViewport(width);
    renderSettings(pieces);
    const dock = screen.getByTestId('dock');
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const bar = screen.getByRole('button', { name: 'Deafen' });
    const main = screen.getByRole('main');
    expect(within(nav).getByText('your card')).toBeInTheDocument();
    const order = [dock, nav, bar, main];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(bar.closest('[data-slot="call-bar"]')).not.toBeNull();
  });

  it('on a phone: the shown pane, then the call bar, then the dock bar', () => {
    mockViewport(WIDTH.phone);
    renderSettings({ ...pieces, phonePane: 'content' });
    const main = screen.getByRole('main');
    const bar = screen.getByRole('button', { name: 'Deafen' });
    const dock = screen.getByTestId('dock');
    expect(main.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('without them nothing is added', () => {
    mockViewport(WIDTH.wide);
    renderSettings();
    expect(document.querySelector('[data-slot="call-bar"]')).toBeNull();
    expect(screen.queryByTestId('dock')).toBeNull();
  });
});
