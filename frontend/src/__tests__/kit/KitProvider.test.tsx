import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button, ButtonBase } from '@mui/material';
import { ThemeProvider, createTheme, useTheme, type Theme } from '@mui/material/styles';
import { KitProvider, KitRoot, kitTheme } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';
import { createLoungeTheme } from '../../kit/theme/createLoungeTheme';
import { derivePalette } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';
import { generateTheme } from '../../theme/themeConfig';

function ThemeProbe({ onTheme }: { onTheme: (theme: Theme) => void }) {
  const theme = useTheme();
  onTheme(theme);
  return null;
}

interface ProbeSnapshot {
  accent: string;
  components: string[];
  scale: unknown;
}

function snapshot(theme: Theme): ProbeSnapshot {
  return {
    accent: theme.lounge?.palette.accent ?? '(no lounge theme)',
    components: Object.keys(theme.components ?? {}).sort(),
    scale: (theme.typography as unknown as { scale?: unknown }).scale,
  };
}

/** A value the browser has normalised, so a hex and its painted rgb() compare equal. */
function computed(property: 'color' | 'backgroundColor', value: string): string {
  const probe = document.createElement('div');
  probe.style[property] = value;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe)[property];
  probe.remove();
  return resolved;
}

describe('KitProvider', () => {
  it('gives kit children the Lounge theme and no old overrides', () => {
    let kitThemeValue: Theme | undefined;
    renderWithKit(
      <ThemeProbe
        onTheme={(theme) => {
          kitThemeValue = theme;
        }}
      />,
    );
    expect(kitThemeValue).toBeDefined();
    const alone = snapshot(kitThemeValue!);
    expect(alone.accent).toBe('#8e75ff');
    expect(alone.components).toEqual(['MuiButtonBase', 'MuiPaper']);
    expect(alone.scale).toBeUndefined();

    let nestedThemeValue: Theme | undefined;
    render(
      <ThemeProvider theme={generateTheme('dark', 'teal', 'minimal')}>
        <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
          <ThemeProbe
            onTheme={(theme) => {
              nestedThemeValue = theme;
            }}
          />
        </KitProvider>
      </ThemeProvider>,
    );
    expect(nestedThemeValue).toBeDefined();
    expect(snapshot(nestedThemeValue!)).toEqual(alone);
  });

  it('maps the lounge palette and tokens onto the MUI theme', () => {
    const palette = derivePalette('#8E75FF', 'dark', 'minimal');
    const theme = createLoungeTheme(palette, 'dark');

    expect(theme.palette.mode).toBe('dark');
    expect(theme.palette.primary.main).toBe(palette.accent);
    expect(theme.palette.primary.contrastText).toBe(palette.onAccent);
    expect(theme.palette.error.main).toBe(palette.danger);
    expect(theme.palette.background.default).toBe(palette.ground);
    expect(theme.palette.background.paper).toBe(palette.surface);
    expect(theme.palette.text.primary).toBe(palette.text);
    expect(theme.palette.text.secondary).toBe(palette.textSecondary);
    expect(theme.palette.divider).toBe(palette.hairline);
    expect(theme.typography.fontFamily).toContain(tokens.font.body);
    expect(theme.typography.fontFamily).toContain('system-ui');
    expect(theme.shape.borderRadius).toBe(tokens.radius.field);

    expect(theme.shadows).toHaveLength(25);
    expect(theme.shadows.every((shadow) => shadow === 'none')).toBe(true);

    expect(theme.components?.MuiButtonBase?.defaultProps).toEqual({ disableRipple: true });
    expect(theme.components?.MuiPaper?.defaultProps).toEqual({ elevation: 0 });

    expect(theme.transitions.duration).toMatchObject({
      shortest: tokens.motion.fast,
      shorter: tokens.motion.fast,
      short: tokens.motion.base,
      standard: tokens.motion.base,
    });
    expect(theme.lounge).toEqual({ tokens, palette, mode: 'dark' });
  });

  it('turns ripples off', () => {
    // MUI 7 mounts the ripple lazily on the first press, so press both.
    const control = render(<ButtonBase>Control</ButtonBase>);
    fireEvent.mouseDown(control.getByRole('button', { name: 'Control' }));
    expect(control.container.querySelector('.MuiTouchRipple-root')).not.toBeNull();
    control.unmount();

    const kit = renderWithKit(<ButtonBase>Kit</ButtonBase>);
    fireEvent.mouseDown(kit.getByRole('button', { name: 'Kit' }));
    expect(kit.container.querySelector('.MuiTouchRipple-root')).toBeNull();
  });

  it('kitTheme throws outside a provider', () => {
    expect(() => kitTheme(createTheme())).toThrow(
      'Kit components must be rendered inside <KitProvider>.',
    );
  });

  it('does not change a sibling old-theme component', () => {
    const oldTheme = generateTheme('dark', 'teal', 'minimal');
    const paint = (element: Element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        background: style.backgroundColor,
        borderRadius: style.borderRadius,
        fontFamily: style.fontFamily,
      };
    };

    const alone = render(
      <ThemeProvider theme={oldTheme}>
        <Button>Old</Button>
      </ThemeProvider>,
    );
    const before = paint(alone.getByRole('button', { name: 'Old' }));
    alone.unmount();

    const together = render(
      <ThemeProvider theme={oldTheme}>
        <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
          <span>kit</span>
        </KitProvider>
        <Button>Old</Button>
      </ThemeProvider>,
    );
    expect(paint(together.getByRole('button', { name: 'Old' }))).toEqual(before);
  });

  it('repaints when the base colour changes', () => {
    const mounts = { count: 0 };
    let latest: Theme | undefined;

    function Probe() {
      const theme = useTheme();
      latest = theme;
      useEffect(() => {
        mounts.count += 1;
      }, []);
      return null;
    }

    function Harness({ base }: { base: string }) {
      return (
        <KitProvider base={base} mode="dark" intensity="minimal">
          <Probe />
        </KitProvider>
      );
    }

    const { rerender } = render(<Harness base="#8E75FF" />);
    expect(latest?.lounge?.palette.accent).toBe('#8e75ff');

    rerender(<Harness base="#0d9488" />);
    expect(latest?.lounge?.palette.accent).toBe('#1c9a8e');
    expect(latest?.lounge?.palette.accent).not.toBe('#8e75ff');
    expect(mounts.count).toBe(1);
  });

  it('KitRoot paints ground and text on itself', () => {
    const palette = derivePalette('#8E75FF', 'dark', 'minimal');
    renderWithKit(<KitRoot data-testid="kit-root">Kit</KitRoot>);

    const root = screen.getByTestId('kit-root');
    const style = getComputedStyle(root);
    expect(style.backgroundColor).toBe(computed('backgroundColor', palette.ground));
    expect(style.color).toBe(computed('color', palette.text));
    expect(style.fontSize).toBe('15px');
    expect(style.lineHeight).toBe('22px');
    expect(style.fontFamily).toContain('Figtree');
  });
});
