import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Button, Checkbox, IconButton, RadioGroup, SelectField, Slider, Switch, Tabs, TextField, Tooltip } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

function Subject() {
  return (
    <>
      <Tooltip label="Mute microphone">
        <IconButton icon="Mic" label="Mute" />
      </Tooltip>
      <button>other</button>
    </>
  );
}

const button = () => screen.getByRole('button', { name: 'Mute' });

describe('Tooltip', () => {
  it('is hidden at first', () => {
    renderWithKit(<Subject />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(button()).not.toHaveAttribute('aria-describedby');
  });

  it('shows on keyboard focus and describes the child', async () => {
    const { user } = renderWithKit(<Subject />);
    await user.tab();
    expect(button()).toHaveFocus();
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Mute microphone');
    expect(button()).toHaveAttribute('aria-describedby', tip.id);
    expect(button()).toHaveAccessibleDescription('Mute microphone');
  });

  it('hides on blur and removes the description', async () => {
    const { user } = renderWithKit(<Subject />);
    await user.tab();
    await screen.findByRole('tooltip');
    await user.tab();
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(button()).not.toHaveAttribute('aria-describedby');
  });

  it('hides on Escape without closing anything around it', async () => {
    const outer = vi.fn();
    const { user } = renderWithKit(
      <div role="presentation" onKeyDown={outer}>
        <Subject />
      </div>,
    );
    await user.tab();
    await screen.findByRole('tooltip');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(outer).not.toHaveBeenCalled();
  });

  it('shows after a delay on mouse hover and hides when the pointer leaves', async () => {
    const { user } = renderWithKit(<Subject />);
    await user.hover(button());
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Mute microphone');
    await user.unhover(button());
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('a pointer that leaves before the delay never shows it', async () => {
    vi.useFakeTimers();
    try {
      renderWithKit(<Subject />);
      fireEvent.pointerEnter(button(), { pointerType: 'mouse' });
      fireEvent.pointerLeave(button(), { pointerType: 'mouse' });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a touch pointer never shows it', () => {
    vi.useFakeTimers();
    try {
      renderWithKit(<Subject />);
      fireEvent.pointerEnter(button(), { pointerType: 'touch' });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds text only', async () => {
    const { user } = renderWithKit(<Subject />);
    await user.tab();
    const tip = await screen.findByRole('tooltip');
    expect(tip.querySelector('button, a, input, [tabindex]')).toBeNull();
  });

  it('is hidden from the description until it shows, and Escape keeps reaching the focused child', async () => {
    const onKeyDown = vi.fn();
    const { user } = renderWithKit(
      <Tooltip label="Search messages">
        <TextField label="Search" value="" onChange={() => {}} onKeyDown={onKeyDown} />
      </Tooltip>,
    );
    await user.tab();
    await screen.findByRole('tooltip');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(onKeyDown).toHaveBeenCalled();
  });
});

describe('Tooltip description wiring', () => {
  it('a TextField keeps its helper text and adds the tooltip on the input', async () => {
    const { user } = renderWithKit(
      <Tooltip label="Visible to everyone">
        <TextField label="Name" helper="Letters only" value="" onChange={() => {}} />
      </Tooltip>,
    );
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveAccessibleDescription('Letters only');
    await user.tab();
    expect(input).toHaveFocus();
    await screen.findByRole('tooltip');
    expect(input).toHaveAccessibleDescription('Letters only Visible to everyone');
    await user.tab();
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(input).toHaveAccessibleDescription('Letters only');
    expect(input.getAttribute('aria-describedby')).not.toMatch(/\s/);
  });

  it('a SelectField takes the tooltip on its combobox and keeps the helper', async () => {
    const { user } = renderWithKit(
      <Tooltip label="Changes who sees you">
        <SelectField
          label="Who can DM you"
          helper="Pick one"
          value=""
          onChange={() => {}}
          options={[{ value: 'a', label: 'A' }]}
        />
      </Tooltip>,
    );
    await user.tab();
    await screen.findByRole('tooltip');
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription('Pick one Changes who sees you');
  });

  it.each([
    ['Checkbox', <Checkbox key="c" label="Mute" description="Silences it" checked={false} onChange={() => {}} />, 'checkbox'],
    ['Switch', <Switch key="s" label="Mute" description="Silences it" checked={false} onChange={() => {}} />, 'switch'],
    [
      'RadioGroup',
      <RadioGroup
        key="r"
        label="Mode"
        value="a"
        onChange={() => {}}
        options={[{ value: 'a', label: 'A', description: 'The first' }]}
      />,
      'radio',
    ],
    ['Slider', <Slider key="sl" label="Volume" value={3} min={0} max={10} onChange={() => {}} />, 'slider'],
    ['Button', <Button key="b">Go</Button>, 'button'],
    [
      'Tabs',
      <Tabs key="t" label="Views" value="a" onChange={() => {}} tabs={[{ id: 'a', label: 'One' }]} />,
      'tab',
    ],
  ])('a %s gets the description on the focused element', async (_name, child, role) => {
    const { user } = renderWithKit(<Tooltip label="A hint">{child}</Tooltip>);
    await user.tab();
    const tip = await screen.findByRole('tooltip');
    const focused = document.activeElement as HTMLElement;
    expect(focused).toBe(screen.getByRole(role));
    expect(focused.getAttribute('aria-describedby')?.split(' ')).toContain(tip.id);
  });

  it('a plain element keeps its own description while the tooltip is open and gets it back after', async () => {
    const { user } = renderWithKit(
      <>
        <span id="own">Own description</span>
        <Tooltip label="A hint">
          <button type="button" aria-describedby="own">
            Plain
          </button>
        </Tooltip>
      </>,
    );
    const button = screen.getByRole('button', { name: 'Plain' });
    await user.tab();
    const tip = await screen.findByRole('tooltip');
    expect(button.getAttribute('aria-describedby')?.split(' ').sort()).toEqual(['own', tip.id].sort());
    await user.tab();
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(button).toHaveAttribute('aria-describedby', 'own');
  });

  it('a plain element with no description is left with none after', async () => {
    const { user } = renderWithKit(
      <Tooltip label="A hint">
        <button type="button">Plain</button>
      </Tooltip>,
    );
    await user.tab();
    await screen.findByRole('tooltip');
    expect(screen.getByRole('button', { name: 'Plain' })).toHaveAccessibleDescription('A hint');
    await user.tab();
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Plain' })).not.toHaveAttribute('aria-describedby');
  });

  it('never opens from a tap into a text field', async () => {
    renderWithKit(
      <Tooltip label="A hint">
        <TextField label="Name" value="" onChange={() => {}} />
      </Tooltip>,
    );
    const input = screen.getByRole('textbox');
    fireEvent.pointerDown(input, { pointerType: 'touch' });
    act(() => input.focus());
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
