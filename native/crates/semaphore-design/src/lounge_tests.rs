use crate::lounge::*;

#[test]
fn lounge_shape_and_layout_values() {
    assert_eq!(
        (RADIUS_FIELD, RADIUS_CARD, RADIUS_ISLAND, RADIUS_FULL),
        (14.0, 18.0, 24.0, 9999.0)
    );
    assert_eq!(SPACE_2XS, 2.0);
    assert_eq!(LAYOUT_LEFT_COLUMN, 288.0);
    assert_eq!(MOTION_FAST_MS, 120);
}

#[test]
fn lounge_kit_tokens() {
    assert_eq!(RADIUS_SM, 6.0);
    assert_eq!(ICON_MD, 18.0);
    assert_eq!(BORDER_FOCUS_OFFSET, 2.0);
    assert_eq!(STATE_HOVER, 0.04);
    assert_eq!(STATE_PRESSED_ON_FILL, 0.24);
}

#[test]
fn lounge_text_and_shadow() {
    assert_eq!(
        TEXT_TITLE,
        TextStyle {
            family: "Bricolage Grotesque",
            size: 20.0,
            line_height: 26.0,
            weight: 700
        }
    );
    assert_eq!(TEXT_BODY.family, FONT_BODY);
    assert_eq!(
        SHADOW_OVERLAY,
        Shadow {
            x: 0.0,
            y: 24.0,
            blur: 64.0,
            alpha: 0.6,
            alpha_light: 0.18
        }
    );
    assert_eq!(SHADOW_ISLAND.alpha_light, 0.08);
}
