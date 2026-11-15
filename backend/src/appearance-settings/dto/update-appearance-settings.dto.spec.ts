import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateAppearanceSettingsDto } from './update-appearance-settings.dto';

describe('UpdateAppearanceSettingsDto', () => {
  function createDto(
    partial: Partial<UpdateAppearanceSettingsDto>,
  ): UpdateAppearanceSettingsDto {
    return plainToInstance(UpdateAppearanceSettingsDto, partial);
  }

  it('should accept "balanced" as a valid intensity', async () => {
    const dto = createDto({ intensity: 'balanced' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should accept "minimal" as a valid intensity', async () => {
    const dto = createDto({ intensity: 'minimal' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should accept "vibrant" as a valid intensity', async () => {
    const dto = createDto({ intensity: 'vibrant' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject "subtle" as an intensity value', async () => {
    const dto = createDto({ intensity: 'subtle' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('intensity');
  });

  it('should reject other invalid intensity values', async () => {
    const invalidValues = ['bold', 'extreme', 'none', ''];

    for (const value of invalidValues) {
      const dto = createDto({ intensity: value });
      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('intensity');
    }
  });

  it('should pass validation with an empty object (all fields optional)', async () => {
    const dto = createDto({});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should accept a lowercase #rrggbb baseColor', async () => {
    const dto = createDto({ baseColor: '#8e75ff' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.baseColor).toBe('#8e75ff');
  });

  it('should lowercase an uppercase baseColor', async () => {
    const dto = createDto({ baseColor: '#8E75FF' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.baseColor).toBe('#8e75ff');
  });

  it('should reject a baseColor that is not #rrggbb', async () => {
    const invalidValues = [
      '#8e75f',
      '#8e75fff',
      '8e75ff',
      'purple',
      '#8e75fg',
      '',
    ];

    for (const value of invalidValues) {
      const dto = createDto({ baseColor: value });
      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('baseColor');
    }
  });

  it('should reject null for every field instead of passing it through', async () => {
    const properties = [
      'themeMode',
      'accentColor',
      'intensity',
      'baseColor',
      'matchSystem',
      'newDesign',
    ] as const;

    for (const property of properties) {
      const dto = plainToInstance(UpdateAppearanceSettingsDto, {
        [property]: null,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe(property);
    }
  });

  it('should accept boolean matchSystem and newDesign', async () => {
    const dto = createDto({ matchSystem: true, newDesign: false });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject non-boolean matchSystem and newDesign', async () => {
    for (const property of ['matchSystem', 'newDesign'] as const) {
      for (const value of ['true', 1, 'yes']) {
        const dto = plainToInstance(UpdateAppearanceSettingsDto, {
          [property]: value,
        });
        const errors = await validate(dto);
        expect(errors).toHaveLength(1);
        expect(errors[0].property).toBe(property);
      }
    }
  });
});
