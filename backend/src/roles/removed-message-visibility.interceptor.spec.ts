import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { PermissionsService } from './permissions.service';
import { RemovedMessageVisibilityInterceptor } from './removed-message-visibility.interceptor';

describe('RemovedMessageVisibilityInterceptor', () => {
  const removed = {
    id: 'removed',
    channelId: 'c1',
    deletedAt: new Date('2026-01-01'),
    spans: ['text'],
  };
  const live = { id: 'live', channelId: 'c1', deletedAt: null, spans: ['x'] };

  const context = (user?: { id: string }) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  function run(body: unknown, allowed: boolean, user = { id: 'reader' }) {
    const canSeeRemovedMessages = jest.fn().mockResolvedValue(allowed);
    const interceptor = new RemovedMessageVisibilityInterceptor({
      canSeeRemovedMessages,
    } as unknown as PermissionsService);
    const next: CallHandler = { handle: () => of(body) };
    return {
      canSeeRemovedMessages,
      result: lastValueFrom(interceptor.intercept(context(user), next)),
    };
  }

  it.each([
    ['one message', removed, (b: any) => b.spans],
    ['an array', [removed], (b: any) => b[0].spans],
    [
      'a message page',
      { messages: [removed] },
      (b: any) => b.messages[0].spans,
    ],
    ['a reply page', { replies: [removed] }, (b: any) => b.replies[0].spans],
  ])('blanks %s for an ordinary reader', async (_label, body, spansOf) => {
    expect(spansOf(await run(body, false).result)).toEqual([]);
  });

  it('keeps the page fields around the rows', async () => {
    const body = { messages: [removed], continuationToken: 'next' };
    await expect(run(body, false).result).resolves.toMatchObject({
      continuationToken: 'next',
    });
  });

  it('asks for the reader by id and keeps the content when allowed', async () => {
    const { result, canSeeRemovedMessages } = run(removed, true);
    await expect(result).resolves.toBe(removed);
    expect(canSeeRemovedMessages).toHaveBeenCalledWith('reader', 'c1');
  });

  it('does not check permissions for live messages', async () => {
    const { result, canSeeRemovedMessages } = run({ messages: [live] }, false);
    await expect(result).resolves.toEqual({ messages: [live] });
    expect(canSeeRemovedMessages).not.toHaveBeenCalled();
  });

  it('passes through bodies that are not messages', async () => {
    await expect(run({ replyCount: 1 }, false).result).resolves.toEqual({
      replyCount: 1,
    });
    await expect(run(undefined, false).result).resolves.toBeUndefined();
  });

  it('blanks for a request with no user', async () => {
    const canSeeRemovedMessages = jest.fn();
    const interceptor = new RemovedMessageVisibilityInterceptor({
      canSeeRemovedMessages,
    } as unknown as PermissionsService);
    const body = await lastValueFrom(
      interceptor.intercept(context(), { handle: () => of(removed) }),
    );
    expect((body as typeof removed).spans).toEqual([]);
    expect(canSeeRemovedMessages).not.toHaveBeenCalled();
  });
});
