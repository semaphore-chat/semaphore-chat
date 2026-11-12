import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RbacActions } from '@prisma/client';
import { CreateRoleDto } from './create-role.dto';
import { UpdateRoleDto } from './update-role.dto';

const actions = [RbacActions.READ_MESSAGE];

async function checkCreate(body: Record<string, unknown>) {
  const dto = plainToInstance(CreateRoleDto, { actions, ...body });
  const errors = await validate(dto);
  return { dto, errors: errors.map((e) => e.property) };
}

describe('CreateRoleDto name', () => {
  it('rejects an empty name', async () => {
    expect((await checkCreate({ name: '' })).errors).toContain('name');
  });

  it('rejects a whitespace-only name', async () => {
    expect((await checkCreate({ name: '   \t\n ' })).errors).toContain('name');
  });

  it('accepts exactly 50 characters', async () => {
    const { dto, errors } = await checkCreate({ name: 'a'.repeat(50) });

    expect(errors).toEqual([]);
    expect(dto.name).toHaveLength(50);
  });

  it('rejects 51 characters', async () => {
    expect((await checkCreate({ name: 'a'.repeat(51) })).errors).toContain(
      'name',
    );
  });

  it('trims surrounding whitespace before storing and validating', async () => {
    // 50 characters plus padding: trimming, not the raw length, decides.
    const name = `  ${'a'.repeat(50)}  `;
    const { dto, errors } = await checkCreate({ name });

    expect(errors).toEqual([]);
    expect(dto.name).toBe('a'.repeat(50));
  });
});

describe('UpdateRoleDto name', () => {
  it('leaves an omitted name out (PartialType)', async () => {
    const dto = plainToInstance(UpdateRoleDto, {});
    expect(await validate(dto)).toEqual([]);
  });

  it('rejects a whitespace-only name', async () => {
    const dto = plainToInstance(UpdateRoleDto, { name: '  ' });
    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toContain('name');
  });

  it('trims a renamed role', async () => {
    const dto = plainToInstance(UpdateRoleDto, { name: '  Moderator  ' });
    expect(await validate(dto)).toEqual([]);
    expect(dto.name).toBe('Moderator');
  });
});
