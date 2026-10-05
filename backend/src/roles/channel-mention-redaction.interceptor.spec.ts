import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ChannelMentionRedactionInterceptor } from './channel-mention-redaction.interceptor';
import { ChannelMentionRedactionService } from './channel-mention-redaction.service';

const httpContext = (user?: { id: string }) =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('ChannelMentionRedactionInterceptor', () => {
  let interceptor: ChannelMentionRedactionInterceptor;
  let redaction: Mocked<ChannelMentionRedactionService>;
  const withMention = {
    spans: [{ type: 'CHANNEL_MENTION', channelId: 'hidden', text: null }],
  };

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      ChannelMentionRedactionInterceptor,
    ).compile();
    interceptor = unit;
    redaction = unitRef.get(ChannelMentionRedactionService);
    redaction.forUser.mockResolvedValue({ redacted: true });
  });

  it('runs a response with channel mentions through forUser for the request user', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(httpContext({ id: 'u1' }), {
        handle: () => of(withMention),
      }),
    );
    expect(redaction.forUser).toHaveBeenCalledWith('u1', withMention);
    expect(result).toEqual({ redacted: true });
  });

  it('redacts for nobody (all ids) when unauthenticated', async () => {
    await lastValueFrom(
      interceptor.intercept(httpContext(), { handle: () => of(withMention) }),
    );
    expect(redaction.forUser).toHaveBeenCalledWith(null, withMention);
  });

  it('a redaction failure answers with every mention id removed instead of failing', async () => {
    redaction.forUser.mockRejectedValue(new Error('db down'));
    const body = {
      spans: [
        { type: 'CHANNEL_MENTION', channelId: 'visible-or-not', text: null },
        { type: 'PLAINTEXT', text: 'x' },
      ],
      replyTo: {
        spans: [{ type: 'CHANNEL_MENTION', channelId: 'other', text: null }],
      },
    };
    const result = await lastValueFrom(
      interceptor.intercept(httpContext({ id: 'u1' }), {
        handle: () => of(body),
      }),
    );
    expect(result).toEqual({
      spans: [
        { type: 'CHANNEL_MENTION', channelId: null, text: null },
        { type: 'PLAINTEXT', text: 'x' },
      ],
      replyTo: {
        spans: [{ type: 'CHANNEL_MENTION', channelId: null, text: null }],
      },
    });
  });

  it('passes responses without mentions through untouched', async () => {
    const body = { spans: [{ type: 'PLAINTEXT', text: 'x' }] };
    const result = await lastValueFrom(
      interceptor.intercept(httpContext({ id: 'u1' }), {
        handle: () => of(body),
      }),
    );
    expect(result).toBe(body);
    expect(redaction.forUser).not.toHaveBeenCalled();
  });

  it('leaves non-HTTP contexts alone', async () => {
    const ctx = { getType: () => 'ws' } as unknown as ExecutionContext;
    const result = await lastValueFrom(
      interceptor.intercept(ctx, { handle: () => of(withMention) }),
    );
    expect(result).toBe(withMention);
    expect(redaction.forUser).not.toHaveBeenCalled();
  });
});
