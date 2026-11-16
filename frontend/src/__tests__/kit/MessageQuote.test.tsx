import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { MessageQuote, MessageRow } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

describe('MessageQuote', () => {
  it('with onOpen is a button named for the reply, and opens the original', () => {
    const onOpen = vi.fn();
    renderWithKit(<MessageQuote author="kwam3" line="same time tomorrow?" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reply to kwam3: same time tomorrow?' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('without onOpen is plain text that still says it is a reply', () => {
    renderWithKit(<MessageQuote author="kwam3" line="same time tomorrow?" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/Reply to/)).toBeInTheDocument();
    expect(screen.getByText('same time tomorrow?')).toBeInTheDocument();
  });

  it('a deleted original says so, shows no author and opens nothing', () => {
    const onOpen = vi.fn();
    renderWithKit(<MessageQuote author="kwam3" line="gone" deleted onOpen={onOpen} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Original message was deleted')).toBeInTheDocument();
    expect(screen.queryByText('kwam3')).toBeNull();
  });

  it('is out of the Tab order in a row Tab skips', () => {
    renderWithKit(
      <MessageRow author="aiko" time="8:19 PM" focus={{ tabStop: false }} quote={<MessageQuote author="kwam3" line="hi" onOpen={() => undefined} />} />,
    );
    expect(screen.getByRole('button', { name: 'Reply to kwam3: hi' })).toHaveAttribute('tabindex', '-1');
  });
});
