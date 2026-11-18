import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { ChatPane } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

describe('ChatPane', () => {
  it('draws the header, the list, the floating parts and the composer in that order', () => {
    const { container } = renderWithKit(
      <ChatPane
        header={<h1>head</h1>}
        list={<div>the list</div>}
        typing={<span>typing</span>}
        jump={<button type="button">jump</button>}
        composer={<textarea aria-label="composer" />}
      />,
    );
    const text = container.textContent ?? '';
    expect(text.indexOf('head')).toBeLessThan(text.indexOf('the list'));
    expect(text.indexOf('the list')).toBeLessThan(text.indexOf('typing'));
    expect(screen.getByRole('button', { name: 'jump' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'composer' })).toBeInTheDocument();
  });

  it('says new messages politely, and keeps the live region while there is nothing to say', () => {
    const { rerender } = renderWithKit(<ChatPane list={<div />} />);
    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toBeEmptyDOMElement();
    rerender(<ChatPane list={<div />} announcement="2 new messages from aiko" />);
    expect(screen.getByRole('status')).toHaveTextContent('2 new messages from aiko');
  });

  it('leaves out the header and composer rows when there are none', () => {
    renderWithKit(<ChatPane list={<div>only the list</div>} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('only the list')).toBeInTheDocument();
  });

  it('a cover fills the pane; the conversation stays mounted underneath, inert and silent, and comes back as it was', () => {
    const list = <textarea aria-label="underneath" defaultValue="" />;
    const { rerender } = renderWithKit(
      <ChatPane list={list} announcement="2 new" cover={<ChatPane list={<div>the thread</div>} announcement="" />} />,
    );
    const field = screen.getByLabelText('underneath') as HTMLTextAreaElement;
    expect(field.closest('[inert]')).not.toBeNull();
    expect(screen.getByText('the thread').closest('[inert]')).toBeNull();
    // Hidden live regions say nothing: the covered one is emptied too.
    expect(screen.getAllByRole('status', { hidden: true }).map((live) => live.textContent)).toEqual(['', '']);
    field.value = 'kept';
    rerender(<ChatPane list={list} announcement="2 new" />);
    expect(screen.getByLabelText('underneath')).toBe(field);
    expect(field.value).toBe('kept');
    expect(field.closest('[inert]')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('2 new');
  });
});
