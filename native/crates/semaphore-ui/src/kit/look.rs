//! The paint the web kit's controls and fields compute (`frontend/src/kit/controls/buttonLook.ts`,
//! `theme/onSurface.ts`, `theme/states.ts`), on the derived roles, so the two clients draw the same
//! colours from the same rules. Pure functions of [`Palette`], so they are tested without a window.

use crate::theme::color::{blend, hsla_of};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{
    BORDER_FOCUS, BORDER_FOCUS_OFFSET, CONTROL_LG, CONTROL_MD, CONTROL_SM, RADIUS_FULL, SPACE_LG,
    SPACE_MD, SPACE_XL, STATE_HOVER, STATE_HOVER_ON_FILL, STATE_PRESSED, STATE_PRESSED_ON_FILL,
    TEXT_BODY_STRONG, TEXT_META, TextStyle,
};
use semaphore_design::{Palette, Rgba as Token};
use std::sync::Arc;

pub use super::surface::Surface;
use super::surface::{stand_out_token, tint_base_token};

/// `mix(over, under, alpha)`: `alpha` of `over` blended into `under`, opaque.
pub fn mix(over: Token, under: Token, alpha: f32) -> Token {
    blend(over, under, alpha.clamp(0., 1.))
}

/// The stand-out fill of a soft button or field box on `on` (see [`super::surface`]).
pub fn stand_out_fill(p: &Palette, on: Surface) -> Token {
    stand_out_token(p, on)
}

/// What a hover tint is mixed over for a piece with no background on `on`.
pub fn tint_base(p: &Palette, on: Surface) -> Token {
    tint_base_token(p, on)
}

/// How loud a button is (`design/guide/components.md#which-variant`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ButtonVariant {
    /// The one main action on a surface.
    Primary,
    /// Ordinary actions.
    #[default]
    Soft,
    /// Low-emphasis actions in toolbars and rows.
    Ghost,
    /// A destructive action that is the main action of a confirmation.
    Danger,
    /// A destructive action among other actions.
    QuietDanger,
    /// An inline action that reads like a link.
    Text,
}

impl ButtonVariant {
    pub const ALL: [ButtonVariant; 6] = [
        ButtonVariant::Primary,
        ButtonVariant::Soft,
        ButtonVariant::Ghost,
        ButtonVariant::Danger,
        ButtonVariant::QuietDanger,
        ButtonVariant::Text,
    ];

    pub fn name(self) -> &'static str {
        match self {
            ButtonVariant::Primary => "primary",
            ButtonVariant::Soft => "soft",
            ButtonVariant::Ghost => "ghost",
            ButtonVariant::Danger => "danger",
            ButtonVariant::QuietDanger => "quietDanger",
            ButtonVariant::Text => "text",
        }
    }
}

/// A variant's paint: the resting fill (`None` is transparent) and label, and what hover and
/// pressed tint (`state_base`) by how much of the text colour.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ButtonLook {
    pub background: Option<Token>,
    pub label: Token,
    pub state_base: Token,
    pub hover_amount: f32,
    pub pressed_amount: f32,
}

impl ButtonLook {
    /// The fill under the pointer.
    pub fn hover(&self, p: &Palette) -> Token {
        mix(p.text, self.state_base, self.hover_amount)
    }

    /// The fill while pressed.
    pub fn pressed(&self, p: &Palette) -> Token {
        mix(p.text, self.state_base, self.pressed_amount)
    }

    /// The resting fill, or the layer under it when transparent: what the label is read against.
    pub fn resting(&self) -> Token {
        self.background.unwrap_or(self.state_base)
    }
}

/// `buttonLook(palette, variant, on)`.
pub fn button_look(p: &Palette, variant: ButtonVariant, on: Surface) -> ButtonLook {
    let soft = if on == Surface::Accent {
        p.fill
    } else {
        stand_out_fill(p, on)
    };
    let behind = tint_base(p, on);
    let filled = |background: Token, label: Token| ButtonLook {
        background: Some(background),
        label,
        state_base: background,
        hover_amount: STATE_HOVER_ON_FILL,
        pressed_amount: STATE_PRESSED_ON_FILL,
    };
    let quiet = |background: Option<Token>, label: Token, state_base: Token| ButtonLook {
        background,
        label,
        state_base,
        hover_amount: STATE_HOVER,
        pressed_amount: STATE_PRESSED,
    };
    match variant {
        ButtonVariant::Primary => filled(p.accent, p.on_accent),
        ButtonVariant::Danger => filled(p.danger, p.on_danger),
        ButtonVariant::Soft => quiet(Some(soft), p.text, soft),
        ButtonVariant::QuietDanger => quiet(Some(soft), p.danger, soft),
        ButtonVariant::Ghost => quiet(None, p.text_secondary, behind),
        ButtonVariant::Text => quiet(None, p.accent_text, behind),
    }
}

/// The three control sizes, `control.sm`/`md`/`lg`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ControlSize {
    Sm,
    #[default]
    Md,
    Lg,
}

impl ControlSize {
    pub const ALL: [ControlSize; 3] = [ControlSize::Sm, ControlSize::Md, ControlSize::Lg];

    /// The height (and an icon button's width).
    pub fn height(self) -> f32 {
        match self {
            ControlSize::Sm => CONTROL_SM,
            ControlSize::Md => CONTROL_MD,
            ControlSize::Lg => CONTROL_LG,
        }
    }

    /// A button's side padding (`BUTTON_PADDING`).
    pub fn padding(self) -> f32 {
        match self {
            ControlSize::Sm => SPACE_MD,
            ControlSize::Md => SPACE_LG,
            ControlSize::Lg => SPACE_XL,
        }
    }

    /// A button's label type: `meta` when small, `bodyStrong` otherwise, always at the strong weight.
    pub fn label_type(self) -> TextStyle {
        let base = if self == ControlSize::Sm {
            TEXT_META
        } else {
            TEXT_BODY_STRONG
        };
        TextStyle {
            weight: TEXT_BODY_STRONG.weight,
            ..base
        }
    }
}

/// One run of text in a design-system type style (`tokens.text.*`). It inherits its colour.
pub fn styled_text(style: TextStyle, content: impl Into<SharedString>) -> Div {
    div()
        .font_family(style.family)
        .text_size(px(style.size))
        .line_height(px(style.line_height))
        .font_weight(FontWeight(style.weight as f32))
        .child(content.into())
}

/// A token colour for GPUI.
pub fn c(token: Token) -> Hsla {
    hsla_of(token)
}

/// The focus ring (`focusRing`): `border.focus` of the focus role, `offset` outside the control's
/// edge (negative draws it inside). GPUI has no outline, so it is an absolute child that does not
/// take part in layout; the control must be `relative`. `radius` is the control's own.
pub fn focus_ring(p: &Palette, radius: f32, offset: f32) -> Div {
    let reach = offset + BORDER_FOCUS;
    let ring_radius = if radius >= RADIUS_FULL {
        RADIUS_FULL
    } else {
        (radius + offset.max(0.)).max(0.)
    };
    div()
        .absolute()
        .top(px(-reach))
        .left(px(-reach))
        .right(px(-reach))
        .bottom(px(-reach))
        .rounded(px(ring_radius))
        .border(px(BORDER_FOCUS))
        .border_color(c(p.focus))
}

/// The focus ring at the usual offset, outside the edge.
pub fn outer_focus_ring(p: &Palette, radius: f32) -> Div {
    focus_ring(p, radius, BORDER_FOCUS_OFFSET)
}

/// A control's own focus handle, kept across frames under its id, so the control can draw its
/// ring while it has keyboard focus. Pass it to the base control's `track_focus`.
pub fn focus_handle(id: &ElementId, window: &mut Window, cx: &mut App) -> FocusHandle {
    window
        .use_keyed_state(
            ElementId::NamedChild(Arc::new(id.clone()), "focus".into()),
            cx,
            |_, cx| cx.focus_handle(),
        )
        .read(cx)
        .clone()
}

/// Whether a control shows its focus ring: focused, and the last input came from the keyboard
/// (focus is drawn only for keyboard focus, never after a mouse press).
pub fn shows_focus(handle: &FocusHandle, window: &Window) -> bool {
    handle.is_focused(window) && window.last_input_was_keyboard()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::theme::color::contrast_ratio;
    use crate::theme::{Sem, ThemeInput};
    use core::prelude::v1::test;
    use semaphore_design::{Intensity, Mode};

    /// Every hue at 30 degree steps, plus grey and the default, in both modes and intensities.
    pub(crate) fn inputs() -> Vec<ThemeInput> {
        let mut bases: Vec<u32> = vec![
            0xff0000, 0xff8000, 0xffff00, 0x80ff00, 0x00ff00, 0x00ff80, 0x00ffff, 0x0080ff,
            0x0000ff, 0x8000ff, 0xff00ff, 0xff0080,
        ];
        bases.extend([0x808080, 0x8e75ff, 0x0d9488]);
        let mut all = Vec::new();
        for base in bases {
            for mode in Mode::ALL {
                for intensity in Intensity::ALL {
                    all.push(ThemeInput::new(Token(base << 8 | 0xff), mode, intensity));
                }
            }
        }
        all
    }

    fn palette(mode: Mode) -> Palette {
        Sem::new(ThemeInput::new(
            crate::theme::DEFAULT_BASE,
            mode,
            Intensity::Minimal,
        ))
        .roles
    }

    #[test]
    fn mix_matches_the_web() {
        // mix('#ffffff', '#000000', 0.5) is #808080 on the web (round half up).
        assert_eq!(
            mix(Token(0xffffffff), Token(0x000000ff), 0.5),
            Token(0x808080ff)
        );
        assert_eq!(
            mix(Token(0xffffffff), Token(0x000000ff), 2.),
            Token(0xffffffff)
        );
        assert_eq!(
            mix(Token(0xffffffff), Token(0x000000ff), -1.),
            Token(0x000000ff)
        );
    }

    #[test]
    fn a_fill_stands_out_from_its_layer() {
        let p = palette(Mode::Dark);
        assert_eq!(stand_out_fill(&p, Surface::Ground), p.fill);
        assert_eq!(stand_out_fill(&p, Surface::Surface), p.fill);
        assert_eq!(stand_out_fill(&p, Surface::Fill), p.surface);
        assert_eq!(
            stand_out_fill(&p, Surface::Accent),
            mix(p.on_accent, p.accent, STATE_PRESSED_ON_FILL)
        );
        assert_eq!(tint_base(&p, Surface::Ground), p.ground);
        assert_eq!(tint_base(&p, Surface::Surface), p.surface);
        assert_eq!(tint_base(&p, Surface::Fill), p.fill);
        assert_eq!(tint_base(&p, Surface::Accent), p.accent);
    }

    #[test]
    fn each_variant_paints_its_roles() {
        for mode in Mode::ALL {
            let p = palette(mode);
            let look = |v| button_look(&p, v, Surface::Surface);
            let primary = look(ButtonVariant::Primary);
            assert_eq!(primary.background, Some(p.accent));
            assert_eq!(primary.label, p.on_accent);
            assert_eq!(
                primary.hover(&p),
                mix(p.text, p.accent, STATE_HOVER_ON_FILL)
            );
            assert_eq!(
                primary.pressed(&p),
                mix(p.text, p.accent, STATE_PRESSED_ON_FILL)
            );
            let danger = look(ButtonVariant::Danger);
            assert_eq!(danger.background, Some(p.danger));
            assert_eq!(danger.label, p.on_danger);
            let soft = look(ButtonVariant::Soft);
            assert_eq!(soft.background, Some(p.fill));
            assert_eq!(soft.label, p.text);
            assert_eq!(soft.hover(&p), mix(p.text, p.fill, STATE_HOVER));
            let quiet = look(ButtonVariant::QuietDanger);
            assert_eq!(quiet.background, Some(p.fill));
            assert_eq!(quiet.label, p.danger);
            let ghost = look(ButtonVariant::Ghost);
            assert_eq!(ghost.background, None);
            assert_eq!(ghost.label, p.text_secondary);
            assert_eq!(ghost.state_base, p.surface);
            assert_eq!(ghost.pressed(&p), mix(p.text, p.surface, STATE_PRESSED));
            let text = look(ButtonVariant::Text);
            assert_eq!(text.background, None);
            assert_eq!(text.label, p.accent_text);
        }
    }

    #[test]
    fn the_soft_variants_follow_the_layer() {
        let p = palette(Mode::Dark);
        for (on, fill) in [
            (Surface::Ground, p.fill),
            (Surface::Surface, p.fill),
            (Surface::Fill, p.surface),
            // On the accent pill a soft button keeps a plain fill chip.
            (Surface::Accent, p.fill),
        ] {
            assert_eq!(
                button_look(&p, ButtonVariant::Soft, on).background,
                Some(fill)
            );
            assert_eq!(
                button_look(&p, ButtonVariant::QuietDanger, on).background,
                Some(fill)
            );
        }
        assert_eq!(
            button_look(&p, ButtonVariant::Ghost, Surface::Ground).state_base,
            p.ground
        );
        assert_eq!(
            button_look(&p, ButtonVariant::Text, Surface::Fill).state_base,
            p.fill
        );
    }

    #[test]
    fn sizes_come_from_the_control_tokens() {
        assert_eq!(ControlSize::Sm.height(), 32.);
        assert_eq!(ControlSize::Md.height(), 40.);
        assert_eq!(ControlSize::Lg.height(), 48.);
        assert_eq!(ControlSize::Sm.padding(), 12.);
        assert_eq!(ControlSize::Md.padding(), 16.);
        assert_eq!(ControlSize::Lg.padding(), 24.);
        assert_eq!(ControlSize::Sm.label_type().size, 13.);
        assert_eq!(ControlSize::Md.label_type().size, 15.);
        for size in ControlSize::ALL {
            assert_eq!(size.label_type().weight, 600);
        }
        assert_eq!(ControlSize::default(), ControlSize::Md);
        assert_eq!(ButtonVariant::default(), ButtonVariant::Soft);
    }

    #[test]
    fn every_label_reads_on_its_resting_fill() {
        // The sweep the theme tests run, for the new pairings: every label on its own resting
        // fill, on every layer, for every base, mode and intensity. 4.5:1 is text contrast.
        for input in inputs() {
            let p = Sem::new(input).roles;
            for on in [Surface::Ground, Surface::Surface, Surface::Fill] {
                for variant in ButtonVariant::ALL {
                    let look = button_look(&p, variant, on);
                    let ratio = contrast_ratio(look.label, look.resting());
                    assert!(
                        ratio >= 4.5,
                        "{} {} on {on:?}: {ratio:.2}:1",
                        input.name(),
                        variant.name()
                    );
                }
            }
        }
    }
}
