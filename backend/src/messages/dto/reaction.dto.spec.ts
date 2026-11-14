import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { randomUUID } from 'crypto';
import { AddReactionDto } from './add-reaction.dto';
import { RemoveReactionDto } from './remove-reaction.dto';

describe.each([
  ['AddReactionDto', AddReactionDto],
  ['RemoveReactionDto', RemoveReactionDto],
] as const)('%s emoji', (_name, Dto) => {
  const messageId = randomUUID();

  function create(emoji: string) {
    return plainToInstance(Dto, { messageId, emoji });
  }

  it('accepts a normal unicode emoji', async () => {
    await expect(validate(create('👍'))).resolves.toHaveLength(0);
  });

  it('accepts a custom emoji sentinel', async () => {
    await expect(
      validate(create(`custom:${randomUUID()}`)),
    ).resolves.toHaveLength(0);
  });

  it('rejects an emoji longer than 64 characters', async () => {
    const errors = await validate(create('a'.repeat(65)));
    expect(errors.map((e) => e.property)).toContain('emoji');
  });

  it('accepts an emoji of exactly 64 characters', async () => {
    await expect(validate(create('a'.repeat(64)))).resolves.toHaveLength(0);
  });
});
