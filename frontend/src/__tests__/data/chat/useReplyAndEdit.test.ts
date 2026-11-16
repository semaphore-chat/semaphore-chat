import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReplyAndEdit, type UseReplyAndEditOptions } from '../../../data/chat/useReplyAndEdit';
import { createMessage, resetFactoryCounter } from '../../test-utils/factories';
import { VoiceSessionType } from '../../../contexts/VoiceContext';
import { SpanType, type Span } from '../../../types/message.type';

const ME = 'me';
const spans: Span[] = [{ type: SpanType.PLAINTEXT, text: 'hi' }];

describe('useReplyAndEdit', () => {
  beforeEach(() => resetFactoryCounter());

  function setup(overrides: Partial<UseReplyAndEditOptions> = {}) {
    const onSendMessage = vi.fn();
    const view = renderHook((props: UseReplyAndEditOptions) => useReplyAndEdit(props), {
      initialProps: {
        contextType: VoiceSessionType.Channel,
        contextId: 'channel-1',
        authorId: ME,
        messages: [],
        onSendMessage,
        ...overrides,
      },
    });
    return { ...view, onSendMessage };
  }

  describe('quote reply', () => {
    it('sends with the reply id, then clears the reply', () => {
      const target = createMessage({ id: 'm-1' });
      const { result, onSendMessage } = setup();

      act(() => result.current.handleQuoteReply(target));
      expect(result.current.replyToMessage).toBe(target);

      act(() => result.current.wrappedOnSendMessage('hi', spans));
      expect(onSendMessage).toHaveBeenCalledWith('hi', spans, undefined, 'm-1');
      expect(result.current.replyToMessage).toBeNull();
    });

    it('sends without a reply id when not replying', () => {
      const { result, onSendMessage } = setup();
      const files = [new File(['x'], 'x.txt')];

      act(() => result.current.wrappedOnSendMessage('hi', spans, files));
      expect(onSendMessage).toHaveBeenCalledWith('hi', spans, files, undefined);
    });

    it('cancels a reply', () => {
      const { result } = setup();
      act(() => result.current.handleQuoteReply(createMessage({ id: 'm-1' })));
      act(() => result.current.handleCancelReply());
      expect(result.current.replyToMessage).toBeNull();
    });

    it('drops the reply when the conversation changes', () => {
      const { result, rerender, onSendMessage } = setup();
      act(() => result.current.handleQuoteReply(createMessage({ id: 'm-1' })));

      rerender({
        contextType: VoiceSessionType.Channel,
        contextId: 'channel-2',
        authorId: ME,
        messages: [],
        onSendMessage,
      });
      expect(result.current.replyToMessage).toBeNull();
    });
  });

  describe('up-arrow edit', () => {
    it('requests the edit of my newest confirmed, undeleted message (messages are newest first)', () => {
      const messages = [
        createMessage({ id: 'pending-9', authorId: ME, clientId: 'c-9', sendStatus: 'pending' }),
        createMessage({ id: 'other', authorId: 'someone-else' }),
        createMessage({ id: 'deleted', authorId: ME, deletedAt: new Date().toISOString() }),
        createMessage({ id: 'mine-2', authorId: ME }),
        createMessage({ id: 'mine-1', authorId: ME }),
      ];
      const { result } = setup({ messages });

      let found = false;
      act(() => {
        found = result.current.handleEditLastMessage();
      });
      expect(found).toBe(true);
      expect(result.current.editRequestValue.request).toEqual({ messageId: 'mine-2', seq: 1 });
    });

    it('returns false when I have no message, or while my id is unknown', () => {
      const { result } = setup({ messages: [createMessage({ id: 'x', authorId: 'someone-else' })] });
      expect(result.current.handleEditLastMessage()).toBe(false);

      const unknown = setup({ authorId: '', messages: [createMessage({ id: 'y', authorId: '' })] });
      expect(unknown.result.current.handleEditLastMessage()).toBe(false);
      expect(unknown.result.current.editRequestValue.request).toBeNull();
    });

    it('numbers repeated requests, and clear only takes the current one', () => {
      const { result } = setup({ messages: [createMessage({ id: 'mine', authorId: ME })] });

      act(() => {
        result.current.handleEditLastMessage();
      });
      act(() => {
        result.current.handleEditLastMessage();
      });
      expect(result.current.editRequestValue.request).toEqual({ messageId: 'mine', seq: 2 });

      // A stale clear (seq 1) leaves the newer request alone.
      act(() => result.current.editRequestValue.clear(1));
      expect(result.current.editRequestValue.request).toEqual({ messageId: 'mine', seq: 2 });

      act(() => result.current.editRequestValue.clear(2));
      expect(result.current.editRequestValue.request).toBeNull();
    });
  });
});
