import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { MessageEditForm, type MessageEditFormProps } from '../../components/Message/MessageEditForm';
import type { FileMetadata } from '../../types/message.type';

function defaultProps(overrides: Partial<MessageEditFormProps> = {}): MessageEditFormProps {
  return {
    editText: '',
    editAttachments: [],
    onTextChange: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    onRemoveAttachment: vi.fn(),
    ...overrides,
  };
}

describe('MessageEditForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders text field with initial value', () => {
    const props = defaultProps({ editText: 'Hello world' });
    renderWithProviders(<MessageEditForm {...props} />);

    const textbox = screen.getByRole('textbox');
    expect(textbox).toHaveValue('Hello world');
  });

  it('calls onTextChange when typing in the text field', async () => {
    const onTextChange = vi.fn();
    const props = defaultProps({ onTextChange });
    const { user } = renderWithProviders(<MessageEditForm {...props} />);

    const textbox = screen.getByRole('textbox');
    await user.type(textbox, 'a');

    expect(onTextChange).toHaveBeenCalledWith('a');
  });

  it('calls onSave when Enter is pressed without Shift', async () => {
    const onSave = vi.fn();
    const props = defaultProps({ editText: 'Some text', onSave });
    const { user } = renderWithProviders(<MessageEditForm {...props} />);

    const textbox = screen.getByRole('textbox');
    await user.click(textbox);
    await user.keyboard('{Enter}');

    expect(onSave).toHaveBeenCalledOnce();
  });

  it('does not call onSave when Shift+Enter is pressed', async () => {
    const onSave = vi.fn();
    const props = defaultProps({ editText: 'Some text', onSave });
    const { user } = renderWithProviders(<MessageEditForm {...props} />);

    const textbox = screen.getByRole('textbox');
    await user.click(textbox);
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onCancel when Escape is pressed', async () => {
    const onCancel = vi.fn();
    const props = defaultProps({ editText: 'Some text', onCancel });
    const { user } = renderWithProviders(<MessageEditForm {...props} />);

    const textbox = screen.getByRole('textbox');
    await user.click(textbox);
    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('marks Escape handled so the global Esc shortcut does not also fire', () => {
    const props = defaultProps({ editText: 'Some text' });
    renderWithProviders(<MessageEditForm {...props} />);
    expect(fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })).toBe(false);
    expect(props.onCancel).toHaveBeenCalledOnce();
  });

  it('disables save button when text is empty and no attachments', () => {
    const props = defaultProps({ editText: '', editAttachments: [] });
    renderWithProviders(<MessageEditForm {...props} />);

    const buttons = screen.getAllByRole('button');
    // The save button (first icon button) should be disabled
    const saveButton = buttons[0];
    expect(saveButton).toBeDisabled();
  });

  it('enables save button when text is not empty', () => {
    const props = defaultProps({ editText: 'Some text' });
    renderWithProviders(<MessageEditForm {...props} />);

    const buttons = screen.getAllByRole('button');
    const saveButton = buttons[0];
    expect(saveButton).not.toBeDisabled();
  });

  it('enables save button when text is empty but attachments exist', () => {
    const attachment: FileMetadata = {
      id: 'att-1',
      filename: 'test.png',
      mimeType: 'image/png',
      fileType: 'IMAGE',
      size: 1024,
    };
    const props = defaultProps({ editText: '', editAttachments: [attachment] });
    renderWithProviders(<MessageEditForm {...props} />);

    const buttons = screen.getAllByRole('button');
    const saveButton = buttons[0];
    expect(saveButton).not.toBeDisabled();
  });

  it('renders attachment chips with filenames', () => {
    const attachments: FileMetadata[] = [
      { id: 'att-1', filename: 'photo.png', mimeType: 'image/png', fileType: 'IMAGE', size: 1024 },
      { id: 'att-2', filename: 'doc.pdf', mimeType: 'application/pdf', fileType: 'DOCUMENT', size: 2048 },
    ];
    const props = defaultProps({ editAttachments: attachments });
    renderWithProviders(<MessageEditForm {...props} />);

    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText('doc.pdf')).toBeInTheDocument();
  });

  it('calls onRemoveAttachment with attachment id when chip delete is clicked', async () => {
    const onRemoveAttachment = vi.fn();
    const attachment: FileMetadata = {
      id: 'att-1',
      filename: 'photo.png',
      mimeType: 'image/png',
      fileType: 'IMAGE',
      size: 1024,
    };
    const props = defaultProps({ editAttachments: [attachment], onRemoveAttachment });
    const { user } = renderWithProviders(<MessageEditForm {...props} />);

    // MUI Chip renders a delete button with an SVG icon; find it by the cancel/close icon
    const chip = screen.getByText('photo.png').closest('.MuiChip-root');
    expect(chip).toBeInTheDocument();

    const deleteButton = chip!.querySelector('.MuiChip-deleteIcon');
    expect(deleteButton).toBeInTheDocument();

    await user.click(deleteButton!);
    expect(onRemoveAttachment).toHaveBeenCalledWith('att-1');
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const onCancel = vi.fn();
    const props = defaultProps({ editText: 'text', onCancel });
    const { user } = renderWithProviders(<MessageEditForm {...props} />);

    // Save button is first, cancel button is second
    const buttons = screen.getAllByRole('button');
    const cancelButton = buttons[1];
    await user.click(cancelButton);

    expect(onCancel).toHaveBeenCalledOnce();
  });
});
