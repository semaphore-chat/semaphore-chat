import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { Composer, type ComposerProps } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';
import { expectNoAxeViolations, runAxe } from '../test-utils/a11y';

const field = () => screen.getByRole('textbox', { name: 'Message #general' });
const send = () => screen.getByRole('button', { name: 'Send message' });

function Live(props: Partial<ComposerProps> & { initial?: string }) {
  const { initial = '', ...rest } = props;
  const [value, setValue] = useState(initial);
  return <Composer label="Message #general" value={value} onChange={setValue} onSubmit={vi.fn()} {...rest} />;
}

describe('Composer', () => {
  it('is a multiline field named by its label, with the label as placeholder', () => {
    renderWithKit(<Live />);
    expect(field().tagName).toBe('TEXTAREA');
    expect(field()).toHaveAttribute('placeholder', 'Message #general');
  });

  it('sends on Enter, starts a line on Shift+Enter, and never sends while composing text (IME)', async () => {
    const onSubmit = vi.fn();
    const { user } = renderWithKit(<Live onSubmit={onSubmit} />);
    await user.type(field(), 'hi');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(field()).toHaveValue('hi\n');
    fireEvent.keyDown(field(), { key: 'Enter', isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not send blank text: Send stays focusable and reads as unavailable', async () => {
    const onSubmit = vi.fn();
    const { user } = renderWithKit(<Live onSubmit={onSubmit} initial="   " />);
    expect(send()).toHaveAttribute('aria-disabled', 'true');
    expect(send()).not.toBeDisabled();
    await user.click(send());
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('sends with only attachments when canSend says so', async () => {
    const onSubmit = vi.fn();
    const { user } = renderWithKit(<Live onSubmit={onSubmit} canSend />);
    await user.click(send());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('while sending, Send is busy and ignores presses, and the field stays editable', async () => {
    const onSubmit = vi.fn();
    const { user } = renderWithKit(<Live onSubmit={onSubmit} initial="hi" sending />);
    expect(send()).toHaveAttribute('aria-busy', 'true');
    await user.click(send());
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    await user.type(field(), '!');
    expect(field()).toHaveValue('hi!');
  });

  it('with submitOnEnter off, Enter is a new line', async () => {
    const onSubmit = vi.fn();
    const { user } = renderWithKit(<Live onSubmit={onSubmit} initial="hi" submitOnEnter={false} />);
    await user.type(field(), '{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(field()).toHaveValue('hi\n');
  });

  it("runs the screen's onKeyDown first, and does nothing more when it prevents the default", () => {
    const onSubmit = vi.fn();
    const onKeyDown = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    renderWithKit(<Live onSubmit={onSubmit} initial="hi" onKeyDown={onKeyDown} />);
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the attach button only with onAttach, and an unavailable one ignores presses', async () => {
    const onAttach = vi.fn();
    const { rerender, user } = renderWithKit(<Live />);
    expect(screen.queryByRole('button', { name: 'Attach a file' })).toBeNull();
    rerender(<Live onAttach={onAttach} />);
    await user.click(screen.getByRole('button', { name: 'Attach a file' }));
    expect(onAttach).toHaveBeenCalledTimes(1);
    rerender(<Live onAttach={onAttach} attachUnavailable />);
    await user.click(screen.getByRole('button', { name: 'Attach a file' }));
    expect(onAttach).toHaveBeenCalledTimes(1);
  });

  it('draws the reply banner with its cancel button', async () => {
    const onCancel = vi.fn();
    const { user } = renderWithKit(
      <Live banner={{ kind: 'reply', title: 'Replying to aiko', detail: 'the headset', cancelLabel: 'Cancel reply', onCancel }} />,
    );
    expect(screen.getByText('Replying to aiko')).toBeInTheDocument();
    expect(screen.getByText('the headset')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel reply' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('a notice replaces the field, its buttons, the banner and the tray', () => {
    renderWithKit(
      <Live
        onAttach={vi.fn()}
        attachments={<span>file.png</span>}
        banner={{ kind: 'editing', title: 'Editing message', cancelLabel: 'Cancel editing', onCancel: vi.fn() }}
        notice={{ text: "You can't send messages here", icon: 'Lock' }}
      />,
    );
    expect(screen.getByText("You can't send messages here")).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('file.png')).toBeNull();
  });

  it('shows the attachments tray and the emoji slot', () => {
    renderWithKit(<Live attachments={<span>file.png</span>} emoji={<button type="button">Emoji</button>} />);
    expect(screen.getByText('file.png')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Emoji' })).toBeInTheDocument();
  });

  it('wires a suggestion list for assistive technology while one is open', () => {
    const { rerender } = renderWithKit(<Live popup={{ listId: 'mentions', activeId: 'mention-2' }} />);
    expect(field()).toHaveAttribute('aria-autocomplete', 'list');
    expect(field()).toHaveAttribute('aria-controls', 'mentions');
    expect(field()).toHaveAttribute('aria-activedescendant', 'mention-2');
    rerender(<Live />);
    expect(field()).not.toHaveAttribute('aria-controls');
  });

  it('caps its growth by row count', () => {
    const { container, rerender } = renderWithKit(<Live cap="phone" />);
    // MUI's autosize textarea mirrors the rows in a hidden twin; the cap itself is checked in a real browser.
    expect(container.querySelectorAll('textarea')).toHaveLength(2);
    rerender(<Live cap="keyboard" />);
    expect(field()).toBeInTheDocument();
  });

  it('has no axe violations, with a banner and with a notice', async () => {
    const { container, rerender } = renderWithKit(
      <Live onAttach={vi.fn()} banner={{ kind: 'reply', title: 'Replying to aiko', cancelLabel: 'Cancel reply', onCancel: vi.fn() }} />,
    );
    expectNoAxeViolations(await runAxe(container));
    rerender(<Live notice={{ text: 'Read only' }} />);
    expectNoAxeViolations(await runAxe(container));
  });
});
