import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { randomUUID } from 'crypto';
import { CreateDmGroupDto } from './create-dm-group.dto';
import { AddMembersDto } from './add-members.dto';

describe('CreateDmGroupDto', () => {
  function create(partial: Record<string, unknown>) {
    return plainToInstance(CreateDmGroupDto, partial);
  }

  it('accepts 20 user ids', async () => {
    const dto = create({
      userIds: Array.from({ length: 20 }, () => randomUUID()),
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects more than 20 user ids', async () => {
    const dto = create({
      userIds: Array.from({ length: 21 }, () => randomUUID()),
    });

    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('userIds');
  });

  it('accepts a name of exactly 100 characters', async () => {
    const dto = create({ userIds: [], name: 'a'.repeat(100) });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects a name longer than 100 characters', async () => {
    const dto = create({ userIds: [], name: 'a'.repeat(101) });

    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('name');
  });
});

describe('AddMembersDto', () => {
  function create(userIds: string[]) {
    return plainToInstance(AddMembersDto, { userIds });
  }

  it('accepts 20 user ids', async () => {
    await expect(
      validate(create(Array.from({ length: 20 }, () => randomUUID()))),
    ).resolves.toHaveLength(0);
  });

  it('rejects more than 20 user ids', async () => {
    const errors = await validate(
      create(Array.from({ length: 21 }, () => randomUUID())),
    );
    expect(errors.map((e) => e.property)).toContain('userIds');
  });
});
