/**
 * The kit additions for the chat's write side (PR 10c-2a): SuggestionList, the Composer's `suggestions` slot,
 * AttachmentTile's queued and uploading states, a field in a MessageRow owning its keys, and IconButton following
 * the row's Tab scope.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { AttachmentTile, Composer, IconButton, MessageRow, SuggestionList, type Suggestion } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

const OPTIONS: Suggestion[] = [
  { key: 'here', label: 'here', detail: 'Notify online members in this channel', icon: 'Megaphone' },
  { key: 'u-aiko', label: 'aiko', detail: 'Aiko', avatar: {} },
];
const optionId = (i: number) => `opt-${i}`;

describe('SuggestionList', () => {
  it('is a named listbox whose highlighted option is selected', () => {
    renderWithKit(<SuggestionList id="mentions" label="Mention suggestions" options={OPTIONS} activeIndex={1} optionId={optionId} onPick={vi.fn()} />);
    const list = screen.getByRole('listbox', { name: 'Mention suggestions' });
    expect(list).toHaveAttribute('id', 'mentions');
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.id)).toEqual(['opt-0', 'opt-1']);
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveTextContent('aikoAiko');
  });

  it('a press picks the option without taking focus from the field', () => {
    const onPick = vi.fn();
    renderWithKit(
      <>
        <textarea aria-label="field" />
        <SuggestionList id="m" label="Mention suggestions" options={OPTIONS} activeIndex={0} optionId={optionId} onPick={onPick} />
      </>,
    );
    const field = screen.getByRole('textbox', { name: 'field' });
    field.focus();
    const option = screen.getAllByRole('option')[1];
    expect(fireEvent.mouseDown(option)).toBe(false); // default prevented: focus stays
    expect(fireEvent.pointerDown(option)).toBe(false);
    fireEvent.click(option);
    expect(onPick).toHaveBeenCalledWith(1);
    expect(field).toHaveFocus();
  });

  it('says it is loading while there is nothing to show yet', () => {
    renderWithKit(<SuggestionList id="m" label="Mention suggestions" options={[]} activeIndex={-1} optionId={optionId} onPick={vi.fn()} loading />);
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});

describe('Composer suggestions', () => {
  it('draws the list with the popup wiring, and not under a notice', () => {
    const list = <SuggestionList id="m" label="Mention suggestions" options={OPTIONS} activeIndex={0} optionId={optionId} onPick={vi.fn()} />;
    const { rerender } = renderWithKit(
      <Composer label="Message #lobby" value="@a" onChange={vi.fn()} onSubmit={vi.fn()} popup={{ listId: 'm', activeId: 'opt-0' }} suggestions={list} />,
    );
    const field = screen.getByRole('textbox', { name: 'Message #lobby' });
    expect(field).toHaveAttribute('aria-controls', 'm');
    expect(field).toHaveAttribute('aria-activedescendant', 'opt-0');
    expect(screen.getByRole('listbox', { name: 'Mention suggestions' })).toBeInTheDocument();
    rerender(
      <Composer label="Message #lobby" value="" onChange={vi.fn()} onSubmit={vi.fn()} notice={{ text: 'You can’t send messages here' }} suggestions={list} />,
    );
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('AttachmentTile on its way', () => {
  it('a queued file is not pressable and has a Remove button', () => {
    const onRemove = vi.fn();
    renderWithKit(<AttachmentTile kind="file" name="notes.txt" detail="2 KB" onRemove={onRemove} />);
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
    expect(screen.getByRole('group', { name: 'notes.txt, 2 KB' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove notes.txt' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('a queued picture shows its thumbnail in the file row', () => {
    const { container } = renderWithKit(<AttachmentTile kind="file" name="cat.png" src="data:image/png;base64,AA" onRemove={vi.fn()} />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AA');
  });

  it('an upload shows its progress, a failure its reason and Retry', () => {
    const onRetry = vi.fn();
    const { rerender } = renderWithKit(<AttachmentTile kind="file" name="clip.mp4" detail="12 MB" progress={40} onRemove={vi.fn()} />);
    expect(screen.getByRole('progressbar', { name: 'Uploading clip.mp4' })).toHaveAttribute('aria-valuenow', '40');
    rerender(<AttachmentTile kind="file" name="clip.mp4" detail="12 MB" error="Upload failed: Too large" onRetry={onRetry} onRemove={vi.fn()} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('Upload failed: Too large')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry uploading clip.mp4' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('MessageRow with a field inside', () => {
  it('keys in the inline editor are the field’s: the list’s roving keys never see them', () => {
    const onKeyDown = vi.fn();
    renderWithKit(
      <MessageRow
        author="aiko"
        time="8:19 PM"
        body={<Composer inline mode="save" label="Edit message" value="hi" onChange={vi.fn()} onSubmit={vi.fn()} />}
        focus={{ tabStop: true, onKeyDown }}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Edit message' });
    for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape']) fireEvent.keyDown(field, { key });
    expect(onKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('article'), { key: 'ArrowDown' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('an IconButton in a row that is not the Tab stop is skipped by Tab', () => {
    renderWithKit(
      <MessageRow author="aiko" time="8:19 PM" attachments={<IconButton icon="X" label="Remove a.txt" onClick={vi.fn()} />} focus={{ tabStop: false }} />,
    );
    expect(screen.getByRole('button', { name: 'Remove a.txt' })).toHaveAttribute('tabindex', '-1');
  });
});
