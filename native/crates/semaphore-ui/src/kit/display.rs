//! What only shows something: Icon, Avatar, AvatarStack, Badge, Pill, Spinner, LinearProgress,
//! Skeleton, Alert and Toast, as the web kit draws them (`frontend/src/kit/display/`,
//! `design/guide/components.md`). Each reads the derived roles (`sem.role`) and the generated
//! tokens (`semaphore_design::lounge`).
//!
//! A few builders the old screens use are kept as thin shims (`Chip`, `Snackbar`, a size in px,
//! `Avatar::background`, `Skeleton::sized`), drawn in the new look; they go when their last screen
//! is converted (epic #848, B19).

use super::controls::{Button, ButtonSize, IconButton};
use super::live::LiveElement as _;
use super::surface::{Surface, SurfaceScope, rail_fill, stand_out_fill, tint_base};
use super::{icon_path, lounge_icon_path};
use crate::theme::color::hsla_of;
use crate::theme::{FONT_FAMILY, Sem, SemTheme};
use gpui_kit::accesskit::Live;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{
    self as tokens, AVATAR_LG, AVATAR_MD, AVATAR_SM, AVATAR_XL, AVATAR_XS, BORDER_HAIRLINE,
    BORDER_SELECTED, CONTROL_LG, CONTROL_MD, CONTROL_SM, ICON_LG, ICON_MD, ICON_SM, ICON_XL,
    ICON_XS, MOTION_SLOW_MS, RADIUS_CARD, RADIUS_FULL, RADIUS_MD, RADIUS_SM, SPACE_LG, SPACE_MD,
    SPACE_SM, SPACE_XS, STATE_DISABLED, TextStyle,
};
use semaphore_design::{Icon as IconName, LoungeIcon, Rgba as Token, readable_background};
use std::f32::consts::TAU;
use std::rc::Rc;
use std::time::Duration;
use unicode_segmentation::UnicodeSegmentation as _;

/// Whether anything may animate. `rig-shot` turns motion off so a screenshot can't catch a frame
/// mid-animation; the app should follow the OS setting.
#[derive(Default)]
struct Motion {
    reduced: bool,
}

impl Global for Motion {}

pub fn set_reduced_motion(reduced: bool, cx: &mut App) {
    cx.default_global::<Motion>().reduced = reduced;
}

pub fn reduced_motion(cx: &App) -> bool {
    cx.try_global::<Motion>()
        .is_some_and(|motion| motion.reduced)
}

/// A size from a token scale, or (for the old screens) a side in px.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Dimension<T> {
    Token(T),
    Px(f32),
}

impl<T> From<f32> for Dimension<T> {
    fn from(px: f32) -> Self {
        Dimension::Px(px)
    }
}

impl<T> From<f64> for Dimension<T> {
    fn from(px: f64) -> Self {
        Dimension::Px(px as f32)
    }
}

/// `icon.*`: the sizes an Icon and a Spinner come in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum IconSize {
    Xs,
    #[default]
    Sm,
    Md,
    Lg,
    Xl,
}

impl IconSize {
    pub const ALL: [IconSize; 5] = [
        IconSize::Xs,
        IconSize::Sm,
        IconSize::Md,
        IconSize::Lg,
        IconSize::Xl,
    ];

    pub fn px(self) -> f32 {
        match self {
            IconSize::Xs => ICON_XS,
            IconSize::Sm => ICON_SM,
            IconSize::Md => ICON_MD,
            IconSize::Lg => ICON_LG,
            IconSize::Xl => ICON_XL,
        }
    }

    pub fn name(self) -> &'static str {
        ["xs", "sm", "md", "lg", "xl"][self as usize]
    }
}

impl From<IconSize> for Dimension<IconSize> {
    fn from(size: IconSize) -> Self {
        Dimension::Token(size)
    }
}

/// An icon, tinted: one of the design system's ([`Icon::lounge`]), or one of the old screens' MUI
/// set ([`Icon::new`]). It inherits the text colour unless given one.
#[derive(IntoElement)]
pub struct Icon {
    path: SharedString,
    size: f32,
    color: Option<Hsla>,
}

impl Icon {
    pub fn new(icon: IconName) -> Self {
        Self {
            path: icon_path(icon),
            size: 24.,
            color: None,
        }
    }

    /// One of the design system's icons, at the medium icon size (`icon.md`).
    pub fn lounge(icon: LoungeIcon) -> Self {
        Self {
            path: lounge_icon_path(icon),
            size: ICON_MD,
            color: None,
        }
    }

    pub fn size(mut self, size: f32) -> Self {
        self.size = size;
        self
    }

    pub fn color(mut self, color: Hsla) -> Self {
        self.color = Some(color);
        self
    }
}

impl RenderOnce for Icon {
    fn render(self, window: &mut Window, _: &mut App) -> impl IntoElement {
        let color = self.color.unwrap_or_else(|| window.text_style().color);
        svg()
            .path(self.path)
            .size(px(self.size))
            .flex_shrink_0()
            .text_color(color)
    }
}

/// A run of text in one of the design system's text styles.
pub(super) fn styled(style: TextStyle, content: impl Into<SharedString>) -> Div {
    div()
        .font_family(SharedString::from(style.family))
        .text_size(px(style.size))
        .line_height(px(style.line_height))
        .font_weight(FontWeight(f32::from(style.weight)))
        .whitespace_nowrap()
        .child(content.into())
}

/// A style at another weight: `text.meta` at `text.bodyStrong`'s weight, say.
pub(super) fn weighted(style: TextStyle, weight: u16) -> TextStyle {
    TextStyle { weight, ..style }
}

/// An `Hsla` back to the nearest opaque packed colour.
fn token_of(color: Hsla) -> Token {
    let rgba = gpui_kit::Rgba::from(color);
    let byte = |value: f32| (value * 255.).round() as u32;
    Token(byte(rgba.r) << 24 | byte(rgba.g) << 16 | byte(rgba.b) << 8 | 0xff)
}

/// `n` as a `0xRRGGBBff` colour, for a `#rrggbb` written in a story or test.
pub fn rgb_token(n: u32) -> Token {
    Token(n << 8 | 0xff)
}

// ---------------------------------------------------------------------------------------------
// Avatar

/// `avatar.*`: 20, 28, 36, 44 or 64 px.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AvatarSize {
    Xs,
    Sm,
    #[default]
    Md,
    Lg,
    Xl,
}

impl AvatarSize {
    pub const ALL: [AvatarSize; 5] = [
        AvatarSize::Xs,
        AvatarSize::Sm,
        AvatarSize::Md,
        AvatarSize::Lg,
        AvatarSize::Xl,
    ];

    pub fn px(self) -> f32 {
        match self {
            AvatarSize::Xs => AVATAR_XS,
            AvatarSize::Sm => AVATAR_SM,
            AvatarSize::Md => AVATAR_MD,
            AvatarSize::Lg => AVATAR_LG,
            AvatarSize::Xl => AVATAR_XL,
        }
    }

    pub fn name(self) -> &'static str {
        ["xs", "sm", "md", "lg", "xl"][self as usize]
    }

    /// The token nearest a side in px, for the type and radius of an old screen's avatar.
    pub fn nearest(side: f32) -> AvatarSize {
        Self::ALL
            .into_iter()
            .min_by(|a, b| (a.px() - side).abs().total_cmp(&(b.px() - side).abs()))
            .unwrap_or_default()
    }

    /// The face's type: tag for the small sizes, meta semibold for the middle, section for `xl`.
    fn type_style(self) -> TextStyle {
        match self {
            AvatarSize::Xs | AvatarSize::Sm => tokens::TEXT_TAG,
            AvatarSize::Xl => tokens::TEXT_SECTION,
            _ => weighted(tokens::TEXT_META, tokens::TEXT_BODY_STRONG.weight),
        }
    }

    fn icon(self) -> IconSize {
        IconSize::ALL[self as usize]
    }
}

impl From<AvatarSize> for Dimension<AvatarSize> {
    fn from(size: AvatarSize) -> Self {
        Dimension::Token(size)
    }
}

impl Dimension<AvatarSize> {
    fn side(self) -> f32 {
        match self {
            Dimension::Token(size) => size.px(),
            Dimension::Px(side) => side,
        }
    }

    fn token(self) -> AvatarSize {
        match self {
            Dimension::Token(size) => size,
            Dimension::Px(side) => AvatarSize::nearest(side),
        }
    }
}

/// `circle` for people, `rounded` for communities.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AvatarShape {
    #[default]
    Circle,
    Rounded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Presence {
    Online,
    Away,
    Offline,
    Speaking,
}

impl Presence {
    pub const ALL: [Presence; 4] = [
        Presence::Online,
        Presence::Away,
        Presence::Offline,
        Presence::Speaking,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Presence::Online => "online",
            Presence::Away => "away",
            Presence::Offline => "offline",
            Presence::Speaking => "speaking",
        }
    }
}

/// Name used when a person's name is blank, so an avatar (or a stack) is never unlabelled.
pub const UNNAMED: &str = "Unknown user";

pub(super) fn shown_name(name: &str) -> &str {
    if name.trim().is_empty() {
        UNNAMED
    } else {
        name
    }
}

/// A grapheme that can stand as an initial: starts with a letter, a number or a pictograph.
fn can_be_initial(grapheme: &str) -> bool {
    grapheme
        .chars()
        .next()
        .is_some_and(|c| c.is_alphanumeric() || is_pictographic(c))
}

/// `\p{Extended_Pictographic}` (Unicode `emoji-data.txt`), as the web's initials regex reads it.
/// Not the regional indicators (flags) or the skin-tone modifiers, which are emoji but not
/// pictographs, and only the arrows the property lists.
fn is_pictographic(c: char) -> bool {
    matches!(u32::from(c),
        0xa9 | 0xae | 0x203c | 0x2049 | 0x2122 | 0x2139 | 0x2194..=0x2199 | 0x21a9..=0x21aa
        | 0x231a..=0x231b | 0x2328 | 0x2388 | 0x23cf | 0x23e9..=0x23f3 | 0x23f8..=0x23fa
        | 0x24c2 | 0x25aa..=0x25ab | 0x25b6 | 0x25c0 | 0x25fb..=0x25fe | 0x2600..=0x2605
        | 0x2607..=0x2612 | 0x2614..=0x2685 | 0x2690..=0x2705 | 0x2708..=0x2712 | 0x2714
        | 0x2716 | 0x271d | 0x2721 | 0x2728 | 0x2733..=0x2734 | 0x2744 | 0x2747 | 0x274c
        | 0x274e | 0x2753..=0x2755 | 0x2757 | 0x2763..=0x2767 | 0x2795..=0x2797 | 0x27a1
        | 0x27b0 | 0x27bf | 0x2934..=0x2935 | 0x2b05..=0x2b07 | 0x2b1b..=0x2b1c | 0x2b50
        | 0x2b55 | 0x3030 | 0x303d | 0x3297 | 0x3299 | 0x1f000..=0x1f0ff | 0x1f10d..=0x1f10f
        | 0x1f12f | 0x1f16c..=0x1f171 | 0x1f17e..=0x1f17f | 0x1f18e | 0x1f191..=0x1f19a
        | 0x1f1ad..=0x1f1e5 | 0x1f201..=0x1f20f | 0x1f21a | 0x1f22f | 0x1f232..=0x1f23a
        | 0x1f23c..=0x1f23f | 0x1f249..=0x1f3fa | 0x1f400..=0x1f53d | 0x1f546..=0x1f64f
        | 0x1f680..=0x1f6ff | 0x1f774..=0x1f77f | 0x1f7d5..=0x1f7ff | 0x1f80c..=0x1f80f
        | 0x1f848..=0x1f84f | 0x1f85a..=0x1f85f | 0x1f888..=0x1f88f | 0x1f8ae..=0x1f8ff
        | 0x1f90c..=0x1f93a | 0x1f93c..=0x1f945 | 0x1f947..=0x1faff | 0x1fc00..=0x1fffd)
}

/// Upper-case one grapheme, keeping it as written if that would make it longer (`ß` is not `SS`).
fn upper(grapheme: &str) -> String {
    let cased = grapheme.to_uppercase();
    if cased.graphemes(true).count() == 1 {
        cased
    } else {
        grapheme.to_owned()
    }
}

/// The letters an avatar shows: the first letter of the first two words, or the first two letters
/// of a single word, upper-cased. Counted in graphemes, so an accented letter, a CJK character or
/// an emoji is one. Punctuation and symbols are skipped (`(mike)` is "MI"), and a word with no
/// letter is not a word. Nothing left gives "".
pub fn initials_of(name: &str) -> String {
    let words: Vec<Vec<&str>> = name
        .split_whitespace()
        .map(|word| word.graphemes(true).filter(|g| can_be_initial(g)).collect())
        .filter(|letters: &Vec<&str>| !letters.is_empty())
        .collect();
    let letters: Vec<&str> = match words.as_slice() {
        [] => Vec::new(),
        [only] => only.iter().take(2).copied().collect(),
        [first, second, ..] => vec![first[0], second[0]],
    };
    letters.into_iter().map(upper).collect()
}

/// The accessible name of an avatar: the name (or "Unknown user"), and the presence.
pub fn avatar_label(name: &str, presence: Option<Presence>) -> String {
    match presence {
        Some(presence) => format!("{}, {}", shown_name(name), presence.name()),
        None => shown_name(name).to_owned(),
    }
}

/// A box `by` px outside its parent on every side, its corners `radius + by` so it stays
/// concentric. GPUI grows a spread shadow's box but keeps the element's corner radii, so a ring
/// drawn as one round a circle comes out a rounded square: rings are drawn as these instead.
pub(super) fn outset(by: f32, radius: f32) -> Div {
    div()
        .absolute()
        .top(px(-by))
        .left(px(-by))
        .right(px(-by))
        .bottom(px(-by))
        .rounded(px(radius + by))
}

/// The speaking ring, shared by Avatar and the stack: a gap in the colour of the layer behind,
/// then a ring in the positive colour, both outside the box. Drawn before the face, so it is
/// under it.
pub(super) fn speaking_ring(sem: &Sem, behind: Hsla, radius: f32) -> [Div; 2] {
    [
        outset(BORDER_SELECTED * 2., radius)
            .border(px(BORDER_SELECTED))
            .border_color(sem.role.positive),
        outset(BORDER_SELECTED, radius).bg(behind),
    ]
}

/// A ring of `width` in `color` round a box with corners `radius`, outside it and under it.
fn outline(color: Hsla, width: f32, radius: f32) -> Div {
    outset(width, radius).bg(color)
}

/// The background and ink of a face with its own colour: the colour nudged until the initials
/// (the page or text colour, whichever reads better) reach 4.5:1.
pub fn readable_face(sem: &Sem, colour: Token) -> Option<(Hsla, Hsla)> {
    let found = readable_background(colour, [sem.roles.ground, sem.roles.text])?;
    Some((hsla_of(found.background), hsla_of(found.ink)))
}

/// A person's or community's picture: an image over their initials, which show while it loads
/// and if it fails, so the layout never shifts. Initials on a data colour take whichever of the
/// page and text colours contrasts more. Named `name` (plus the presence) unless `decorative`.
#[derive(IntoElement)]
pub struct Avatar {
    id: Option<ElementId>,
    name: SharedString,
    size: Dimension<AvatarSize>,
    shape: AvatarShape,
    colour: Option<Token>,
    presence: Option<Presence>,
    decorative: bool,
    on: Option<Surface>,
    image: Option<ImageSource>,
    /// A file id to draw through the app's [`AvatarImages`], when it has one.
    file: Option<SharedString>,
    background: Option<Hsla>,
    foreground: Option<Hsla>,
    font_size: Option<f32>,
}

/// A file id to a resource, once its bytes are at hand.
pub type AvatarResolver = std::rc::Rc<dyn Fn(&str) -> Option<Resource>>;

/// Where avatar files come from in the app: a resource for a file id once its bytes are at hand
/// (`None` while they aren't, or never will be), and the bounded cache the decodes live in. Without
/// it, as in stories, avatars are initials.
pub struct AvatarImages {
    pub resolve: AvatarResolver,
    pub cache: Entity<crate::messages::LruImageCache>,
}

impl Global for AvatarImages {}

impl Avatar {
    /// Who it is: the accessible name, and where the initials come from.
    pub fn new(name: impl Into<SharedString>) -> Self {
        Self {
            id: None,
            name: name.into(),
            size: Dimension::Token(AvatarSize::Md),
            shape: AvatarShape::Circle,
            colour: None,
            presence: None,
            decorative: false,
            on: None,
            image: None,
            file: None,
            background: None,
            foreground: None,
            font_size: None,
        }
    }

    /// The element id its accessibility node hangs on; by default one made from the name, so two
    /// named (not decorative) avatars with the same name under one parent each need their own.
    pub fn id(mut self, id: impl Into<ElementId>) -> Self {
        self.id = Some(id.into());
        self
    }

    /// A token size, or (the old screens) a side in px.
    pub fn size(mut self, size: impl Into<Dimension<AvatarSize>>) -> Self {
        self.size = size.into();
        self
    }

    pub fn shape(mut self, shape: AvatarShape) -> Self {
        self.shape = shape;
        self
    }

    /// A person's or community's own colour. For a person: `person_colour(their user id)`.
    pub fn colour(mut self, colour: impl Into<Option<Token>>) -> Self {
        self.colour = colour.into();
        self
    }

    pub fn presence(mut self, presence: impl Into<Option<Presence>>) -> Self {
        self.presence = presence.into();
        self
    }

    /// Hides it from assistive technology, for an avatar beside its own name.
    pub fn decorative(mut self, decorative: bool) -> Self {
        self.decorative = decorative;
        self
    }

    /// The layer it is drawn on: the colour of the presence and speaking rings.
    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }

    /// The picture, drawn over the initials.
    pub fn src(mut self, image: ImageSource) -> Self {
        self.image = Some(image);
        self
    }

    pub fn image(mut self, image: Option<ImageSource>) -> Self {
        self.image = image;
        self
    }

    /// The avatar's file, drawn over the initials once the app has it.
    pub fn file(mut self, file_id: Option<&str>) -> Self {
        self.file = file_id.map(|id| SharedString::from(id.to_owned()));
        self
    }

    /// The old screens' own fill (made readable like `colour`).
    pub fn background(mut self, color: Hsla) -> Self {
        self.background = Some(color);
        self
    }

    /// The old screens' own ink, over the readable one.
    pub fn foreground(mut self, color: Hsla) -> Self {
        self.foreground = Some(color);
        self
    }

    /// The old screens' label size, over the size's text style.
    pub fn text_size_override(mut self, size: f32) -> Self {
        self.font_size = Some(size);
        self
    }
}

impl RenderOnce for Avatar {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let side = self.size.side();
        let token = self.size.token();
        let radius = match self.shape {
            AvatarShape::Circle => RADIUS_FULL,
            AvatarShape::Rounded if token == AvatarSize::Xl => RADIUS_CARD,
            AvatarShape::Rounded => RADIUS_MD,
        };
        let behind = tint_base(&sem, Surface::or_current(self.on, cx));
        let own = self
            .colour
            .or(self.background.map(token_of))
            .and_then(|colour| readable_face(&sem, colour));
        let (fill, ink) = own.unwrap_or((
            stand_out_fill(&sem, Surface::or_current(self.on, cx)),
            sem.role.text_secondary,
        ));
        let ink = self.foreground.unwrap_or(ink);

        let initials = initials_of(&self.name);
        let mut style = token.type_style();
        if let Some(size) = self.font_size {
            style = TextStyle {
                size,
                line_height: size + 2.,
                ..style
            };
        }
        let icon = token.icon().px();
        // Centred in a box of their own: an image's loading and failed views are laid out in its
        // place, not in the face.
        let letters = move || -> AnyElement {
            div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .map(|centre| {
                    if initials.is_empty() {
                        centre.child(Icon::lounge(LoungeIcon::User).size(icon))
                    } else {
                        centre.child(styled(style, initials.clone()))
                    }
                })
                .into_any_element()
        };
        let file = self.file.as_ref().and_then(|file_id| {
            let images = cx.try_global::<AvatarImages>()?;
            Some(((images.resolve)(file_id)?, images.cache.clone()))
        });
        let picture = match (self.image, file) {
            (Some(source), _) => Some(img(source)),
            (None, Some((resource, cache))) => {
                Some(img(ImageSource::Resource(resource)).image_cache(&cache))
            }
            (None, None) => None,
        };
        let face = div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(radius))
            .overflow_hidden()
            .bg(fill)
            .text_color(ink)
            .map(|face| match picture {
                // Initials until the picture is decoded, and if it never is. Once it is, they are
                // gone, so a transparent logo shows its colour behind it and no letters.
                Some(picture) => {
                    let (loading, failed) = (letters.clone(), letters);
                    face.child(
                        picture
                            .size_full()
                            // The parent's clip is a rectangle: the image rounds itself.
                            .rounded(px(radius))
                            .object_fit(ObjectFit::Cover)
                            .with_loading(loading)
                            .with_fallback(failed),
                    )
                }
                None => face.child(letters()),
            });

        let speaking = self.presence == Some(Presence::Speaking);
        let dot = self
            .presence
            .filter(|presence| *presence != Presence::Speaking)
            .map(|presence| presence_dot(&sem, presence, token, behind));
        let root = div()
            .relative()
            .flex_shrink_0()
            .size(px(side))
            .rounded(px(radius))
            .when(speaking, |root| {
                root.children(speaking_ring(&sem, behind, radius))
            })
            .child(face)
            .children(dot);
        if self.decorative {
            return root.into_any_element();
        }
        let label = avatar_label(&self.name, self.presence);
        let id = self
            .id
            .unwrap_or_else(|| ElementId::Name(format!("avatar-{}", self.name).into()));
        root.id(id)
            .test_support()
            .role(Role::Image)
            .aria_label(label)
            .into_any_element()
    }
}

/// Presence by shape as well as colour: online a filled dot, away a filled dot with a bar across
/// it, offline a hollow ring. A ring in the layer's colour separates it from the avatar.
fn presence_dot(sem: &Sem, presence: Presence, size: AvatarSize, behind: Hsla) -> Div {
    let diameter = if size == AvatarSize::Xs {
        SPACE_SM
    } else {
        SPACE_MD
    };
    let dot = div()
        .size_full()
        .flex()
        .items_center()
        .justify_center()
        .rounded_full();
    let dot = match presence {
        Presence::Offline => dot
            .bg(behind)
            .border(px(BORDER_SELECTED))
            .border_color(sem.role.text_dim),
        Presence::Away => dot.bg(sem.role.warning).child(
            div()
                .w(px(diameter - 2. * BORDER_SELECTED))
                .h(px(BORDER_SELECTED))
                .bg(behind),
        ),
        _ => dot.bg(sem.role.positive),
    };
    div()
        .absolute()
        .right(px(-BORDER_HAIRLINE))
        .bottom(px(-BORDER_HAIRLINE))
        .size(px(diameter))
        .child(outline(behind, BORDER_SELECTED, RADIUS_FULL))
        .child(dot)
}

// ---------------------------------------------------------------------------------------------
// AvatarStack

/// One person in an [`AvatarStack`].
#[derive(Clone)]
pub struct StackPerson {
    pub name: SharedString,
    pub colour: Option<Token>,
    pub speaking: bool,
    pub file: Option<SharedString>,
}

impl StackPerson {
    pub fn new(name: impl Into<SharedString>) -> Self {
        Self {
            name: name.into(),
            colour: None,
            speaking: false,
            file: None,
        }
    }

    pub fn colour(mut self, colour: impl Into<Option<Token>>) -> Self {
        self.colour = colour.into();
        self
    }

    pub fn speaking(mut self, speaking: bool) -> Self {
        self.speaking = speaking;
        self
    }

    pub fn file(mut self, file_id: Option<&str>) -> Self {
        self.file = file_id.map(|id| SharedString::from(id.to_owned()));
        self
    }
}

const DEFAULT_STACK_MAX: usize = 3;
/// Up to three speakers by name; more are "A, B and 4 more".
const MAX_NAMED_TALKING: usize = 3;

/// "A", "A and B", "A, B and C": "and" before the last.
fn join_names(names: &[&str]) -> String {
    match names {
        [] => String::new(),
        [only] => (*only).to_owned(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

fn join_talking(names: &[&str]) -> String {
    if names.len() <= MAX_NAMED_TALKING {
        join_names(names)
    } else {
        let named = MAX_NAMED_TALKING - 1;
        format!(
            "{} and {} more",
            names[..named].join(", "),
            names.len() - named
        )
    }
}

/// The stack's accessible name: the shown names and "and N more" ("N people" when none is shown),
/// then who is talking, also behind the "+N": "pri, dropbear and aiko, dropbear is talking".
pub fn stack_label(people: &[StackPerson], max: usize) -> String {
    let shown = people.len().min(max);
    let names: Vec<&str> = people[..shown]
        .iter()
        .map(|person| shown_name(&person.name))
        .collect();
    let extra = people.len() - shown;
    let who = match (extra, names.len()) {
        (0, _) => join_names(&names),
        (_, 0) => format!("{extra} people"),
        _ => format!("{} and {extra} more", names.join(", ")),
    };
    let talking: Vec<&str> = people
        .iter()
        .filter(|person| person.speaking)
        .map(|person| shown_name(&person.name))
        .collect();
    match talking.len() {
        0 => who,
        1 => format!("{who}, {} is talking", join_talking(&talking)),
        _ => format!("{who}, {} are talking", join_talking(&talking)),
    }
}

/// Overlapping avatars, each ringed in the colour of the layer it sits on, with the rest as a
/// "+N" circle. One accessible name for the whole group, as an image; the avatars inside are
/// decorative. A speaker wears the speaking ring and does not overlap its neighbours. No people,
/// nothing drawn.
#[derive(IntoElement)]
pub struct AvatarStack {
    id: ElementId,
    people: Vec<StackPerson>,
    max: usize,
    size: AvatarSize,
    label: Option<SharedString>,
    on: Option<Surface>,
}

impl AvatarStack {
    pub fn new(id: impl Into<ElementId>, people: Vec<StackPerson>) -> Self {
        Self {
            id: id.into(),
            people,
            max: DEFAULT_STACK_MAX,
            size: AvatarSize::Sm,
            label: None,
            on: None,
        }
    }

    /// How many avatars to show before the "+N"; default 3.
    pub fn max(mut self, max: usize) -> Self {
        self.max = max;
        self
    }

    pub fn size(mut self, size: AvatarSize) -> Self {
        self.size = size;
        self
    }

    /// The group's accessible name, in place of the names and who is talking.
    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }
}

impl RenderOnce for AvatarStack {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        if self.people.is_empty() {
            return div().into_any_element();
        }
        let sem = cx.sem().clone();
        let behind = tint_base(&sem, Surface::or_current(self.on, cx));
        let label = self
            .label
            .clone()
            .unwrap_or_else(|| stack_label(&self.people, self.max).into());
        let shown = self.people.len().min(self.max);
        let extra = self.people.len() - shown;
        let speaking: Vec<bool> = self.people[..shown].iter().map(|p| p.speaking).collect();
        // The slot's ring separates overlapping avatars; one after a speaker does not overlap it,
        // and its ring would paint over the speaker's (the web lifts the speaker above it).
        let slot = |index: usize, is_speaker: bool| {
            let after_speaker = index > 0 && speaking.get(index - 1) == Some(&true);
            div()
                .relative()
                .flex()
                .flex_shrink_0()
                .rounded_full()
                .when(!after_speaker, |slot| {
                    slot.child(outline(behind, BORDER_SELECTED, RADIUS_FULL))
                })
                .when(index > 0, |slot| {
                    if is_speaker || after_speaker {
                        slot.ml(px(BORDER_SELECTED * 2.))
                    } else {
                        slot.ml(px(-SPACE_SM))
                    }
                })
        };
        let faces = self.people[..shown]
            .iter()
            .enumerate()
            .map(|(index, person)| {
                slot(index, person.speaking).child(
                    Avatar::new(person.name.clone())
                        .size(self.size)
                        .colour(person.colour)
                        .file(person.file.as_deref())
                        .presence(person.speaking.then_some(Presence::Speaking))
                        .on_surface(Surface::or_current(self.on, cx))
                        .decorative(true),
                )
            })
            .collect::<Vec<_>>();
        let more = (extra > 0).then(|| {
            let style = match self.size {
                AvatarSize::Xs | AvatarSize::Sm => tokens::TEXT_TAG,
                _ => tokens::TEXT_META,
            };
            slot(shown, false).child(
                div()
                    .size(px(self.size.px()))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded_full()
                    .bg(stand_out_fill(&sem, Surface::or_current(self.on, cx)))
                    .text_color(sem.role.text_secondary)
                    .child(styled(
                        weighted(style, tokens::TEXT_BODY_STRONG.weight),
                        format!("+{extra}"),
                    )),
            )
        });
        div()
            .id(self.id)
            .test_support()
            .role(Role::Image)
            .aria_label(label)
            .flex()
            .flex_shrink_0()
            .items_center()
            .children(faces)
            .children(more)
            .into_any_element()
    }
}

// ---------------------------------------------------------------------------------------------
// Badge

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BadgeTone {
    Accent,
    #[default]
    Danger,
}

const DEFAULT_BADGE_MAX: u32 = 99;

/// What a badge shows: nothing for a count below 1 (unless a dot), the count, or "max+".
pub fn badge_text(count: u32, max: u32) -> Option<String> {
    let max = if max < 1 { DEFAULT_BADGE_MAX } else { max };
    match count {
        0 => None,
        count if count > max => Some(format!("{max}+")),
        count => Some(count.to_string()),
    }
}

/// What a count on an item means, in its accessible name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CountMeaning {
    Unread,
    Mentions,
}

/// "3 unread", or "1 mention" / "3 mentions".
pub fn count_words(count: u32, meaning: CountMeaning) -> String {
    match (meaning, count) {
        (CountMeaning::Mentions, 1) => "1 mention".into(),
        (CountMeaning::Mentions, count) => format!("{count} mentions"),
        (CountMeaning::Unread, count) => format!("{count} unread"),
    }
}

/// A count (or a dot) on an item, named by `label` because the number alone does not say what it
/// counts. Renders nothing for a count of 0 unless it is a dot; [`Badge::on`] still draws its child.
#[derive(IntoElement)]
pub struct Badge {
    label: SharedString,
    count: u32,
    max: u32,
    dot: bool,
    tone: BadgeTone,
    on: Option<Surface>,
    decorative: bool,
    id: Option<ElementId>,
    child: Option<AnyElement>,
}

impl Badge {
    /// What it means, e.g. "3 unread": the accessible name.
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            count: 0,
            max: DEFAULT_BADGE_MAX,
            dot: false,
            tone: BadgeTone::Danger,
            on: None,
            decorative: false,
            id: None,
            child: None,
        }
    }

    pub fn count(mut self, count: u32) -> Self {
        self.count = count;
        self
    }

    /// The largest number shown; above it the badge reads "<max>+". Default 99.
    pub fn max(mut self, max: u32) -> Self {
        self.max = max;
        self
    }

    /// A small dot with no number.
    pub fn dot(mut self, dot: bool) -> Self {
        self.dot = dot;
        self
    }

    pub fn tone(mut self, tone: BadgeTone) -> Self {
        self.tone = tone;
        self
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }

    /// Hides it from assistive technology, for a badge inside a control whose name already says
    /// the count ("Notifications, 3 unread"), so the count is not read twice.
    pub fn decorative(mut self, decorative: bool) -> Self {
        self.decorative = decorative;
        self
    }

    /// The element id its accessibility node hangs on; by default one made from the label, so
    /// two badges with the same label under one parent each need their own.
    pub fn id(mut self, id: impl Into<ElementId>) -> Self {
        self.id = Some(id.into());
        self
    }

    /// Overlaps this child, at its top right, as the wrapper around the web's badge does.
    pub fn on(mut self, child: impl IntoElement) -> Self {
        self.child = Some(child.into_any_element());
        self
    }
}

impl RenderOnce for Badge {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        // An accent badge on the accent pill would vanish: it inverts.
        let inverted =
            Surface::or_current(self.on, cx) == Surface::Accent && self.tone == BadgeTone::Accent;
        let (background, ink) = match (inverted, self.tone) {
            (true, _) => (sem.role.on_accent, sem.role.accent),
            (false, BadgeTone::Accent) => (sem.role.accent, sem.role.on_accent),
            (false, BadgeTone::Danger) => (sem.role.danger, sem.role.on_danger),
        };
        let shown = if self.dot {
            Some(None)
        } else {
            badge_text(self.count, self.max).map(Some)
        };
        let id = self
            .id
            .unwrap_or_else(|| ElementId::Name(format!("badge-{}", self.label).into()));
        let (label, decorative) = (self.label.clone(), self.decorative);
        let badge = shown.map(|number| {
            let badge = div()
                .id(id)
                .test_support()
                .when(!decorative, |badge| {
                    badge.role(Role::Image).aria_label(label.clone())
                })
                .flex()
                .flex_shrink_0()
                .items_center()
                .justify_center()
                .rounded_full()
                .bg(background);
            match number {
                None => badge.size(px(SPACE_SM)),
                Some(number) => badge
                    .h(px(ICON_LG))
                    .min_w(px(ICON_LG))
                    .px(px(SPACE_XS))
                    .text_color(ink)
                    .child(styled(tokens::TEXT_TAG, number).line_height(px(ICON_LG))),
            }
        });
        match self.child {
            None => div().flex_shrink_0().children(badge),
            Some(child) => div()
                .relative()
                .flex_shrink_0()
                .child(child)
                .children(badge.map(|badge| {
                    div()
                        .absolute()
                        .top(px(-SPACE_XS))
                        .right(px(-SPACE_XS))
                        .child(badge)
                })),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Pill

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PillTone {
    #[default]
    Neutral,
    Accent,
    Danger,
    Positive,
    Warning,
}

impl PillTone {
    pub const ALL: [PillTone; 5] = [
        PillTone::Neutral,
        PillTone::Accent,
        PillTone::Danger,
        PillTone::Positive,
        PillTone::Warning,
    ];

    pub fn name(self) -> &'static str {
        ["neutral", "accent", "danger", "positive", "warning"][self as usize]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PillSize {
    Sm,
    #[default]
    Md,
}

/// The background and text colour of a pill of `tone` on `on`.
fn pill_look(sem: &Sem, tone: PillTone, on: Surface) -> (Hsla, Hsla) {
    let r = &sem.role;
    let fill = stand_out_fill(sem, on);
    // The status tones keep a plain chip on the accent pill, where the faint tint would not
    // carry their colour.
    let chip = if on == Surface::Accent { r.fill } else { fill };
    match (on, tone) {
        (Surface::Accent, PillTone::Accent) => (r.on_accent, r.accent),
        (Surface::Accent, PillTone::Neutral) => (fill, r.on_accent),
        (_, PillTone::Neutral) => (fill, r.text_secondary),
        (_, PillTone::Accent) => (r.accent, r.on_accent),
        (_, PillTone::Danger) => (chip, r.danger),
        (_, PillTone::Positive) => (chip, r.positive),
        (_, PillTone::Warning) => (chip, r.warning),
    }
}

/// A small rounded tag: a role, a status, or the selected item. Always text; the tone colours it,
/// and a dot or an icon adds a leading mark (decorative: the text carries the meaning). The label
/// gives way with an ellipsis before the pill outgrows its row.
#[derive(IntoElement)]
pub struct Pill {
    label: SharedString,
    tone: PillTone,
    dot: bool,
    icon: Option<LoungeIcon>,
    size: PillSize,
    on: Option<Surface>,
}

impl Pill {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            tone: PillTone::Neutral,
            dot: false,
            icon: None,
            size: PillSize::Md,
            on: None,
        }
    }

    pub fn tone(mut self, tone: PillTone) -> Self {
        self.tone = tone;
        self
    }

    /// A leading dot in the tone colour.
    pub fn dot(mut self, dot: bool) -> Self {
        self.dot = dot;
        self
    }

    pub fn icon(mut self, icon: LoungeIcon) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn size(mut self, size: PillSize) -> Self {
        self.size = size;
        self
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }
}

impl RenderOnce for Pill {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let (background, color) = pill_look(sem, self.tone, Surface::or_current(self.on, cx));
        let (style, height, icon) = match self.size {
            PillSize::Sm => (tokens::TEXT_TAG, ICON_LG, ICON_XS),
            PillSize::Md => (
                weighted(tokens::TEXT_SMALL, tokens::TEXT_BODY_STRONG.weight),
                ICON_XL,
                ICON_SM,
            ),
        };
        div()
            .flex()
            .flex_shrink_0()
            .max_w_full()
            .items_center()
            .gap(px(SPACE_XS))
            .h(px(height))
            .px(px(SPACE_SM))
            .rounded_full()
            .bg(background)
            .text_color(color)
            .when(self.dot, |pill| {
                pill.child(
                    div()
                        .flex_shrink_0()
                        .size(px(SPACE_SM))
                        .rounded_full()
                        .bg(color),
                )
            })
            .children(self.icon.map(|name| Icon::lounge(name).size(icon)))
            .child(
                styled(style, self.label)
                    .min_w_0()
                    .overflow_hidden()
                    .text_ellipsis(),
            )
    }
}

/// The old screens' chip: a [`Pill`]'s neutral look, with their own colours when given. Screens
/// move to `Pill` as they are converted.
#[derive(IntoElement)]
pub struct Chip {
    label: SharedString,
    icon: Option<AnyElement>,
    border: Option<Hsla>,
    text_color: Option<Hsla>,
    background: Option<Hsla>,
}

impl Chip {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            icon: None,
            border: None,
            text_color: None,
            background: None,
        }
    }

    pub fn icon(mut self, icon: impl IntoElement) -> Self {
        self.icon = Some(icon.into_any_element());
        self
    }

    /// The connection banner's warning look.
    pub fn colors(mut self, background: Hsla, border: Hsla, text_color: Hsla) -> Self {
        self.background = Some(background);
        self.border = Some(border);
        self.text_color = Some(text_color);
        self
    }
}

impl RenderOnce for Chip {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let (background, color) = pill_look(sem, PillTone::Neutral, Surface::Ground);
        div()
            .h(px(ICON_XL))
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap(px(SPACE_XS))
            .px(px(SPACE_SM))
            .rounded_full()
            .bg(self.background.unwrap_or(background))
            .text_color(self.text_color.unwrap_or(color))
            .when_some(self.border, |chip, color| {
                chip.border(px(BORDER_HAIRLINE)).border_color(color)
            })
            .children(self.icon)
            .child(styled(
                weighted(tokens::TEXT_SMALL, tokens::TEXT_BODY_STRONG.weight),
                self.label,
            ))
    }
}

// ---------------------------------------------------------------------------------------------
// Spinner

/// MUI's arc, `80px` of a `2π × 20.2` circle: a fixed arc that turns.
const SPINNER_ARC: f32 = 80. / (TAU * 20.2);
/// The stroke as a share of the side: 5 of the 44 units MUI draws the circle in.
const SPINNER_STROKE: f32 = 5. / 44.;
/// One turn.
const SPINNER_TURN: Duration = Duration::from_millis(1400);

/// A busy indicator in the text colour around it. Decorative unless given a `label`, then a named
/// `status`. With motion off it holds still, so a screenshot is exact.
#[derive(IntoElement)]
pub struct Spinner {
    id: ElementId,
    size: Dimension<IconSize>,
    label: Option<SharedString>,
    color: Option<Hsla>,
}

impl Spinner {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            size: Dimension::Token(IconSize::Sm),
            label: None,
            color: None,
        }
    }

    /// An icon size (default `sm`), or (the old screens) a side in px.
    pub fn size(mut self, size: impl Into<Dimension<IconSize>>) -> Self {
        self.size = size.into();
        self
    }

    /// Names the busy state for assistive technology.
    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }

    /// The old screens' own colour, over the inherited text colour.
    pub fn color(mut self, color: Hsla) -> Self {
        self.color = Some(color);
        self
    }
}

/// The arc's path in `bounds`, starting at `turn` (0 to 1) of the way round.
fn spinner_arc(bounds: Bounds<Pixels>, turn: f32) -> Option<Path<Pixels>> {
    let side = bounds.size.width.min(bounds.size.height).as_f32();
    let stroke = side * SPINNER_STROKE;
    let radius = (side - stroke) / 2.;
    let centre = bounds.center();
    let at = |angle: f32| {
        point(
            centre.x + px(radius * angle.cos()),
            centre.y + px(radius * angle.sin()),
        )
    };
    let start = (turn - 0.25) * TAU;
    let end = start + SPINNER_ARC * TAU;
    let mut path = PathBuilder::stroke(px(stroke));
    path.move_to(at(start));
    path.arc_to(
        point(px(radius), px(radius)),
        px(0.),
        SPINNER_ARC > 0.5,
        true,
        at(end),
    );
    path.build().ok()
}

impl RenderOnce for Spinner {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let side = match self.size {
            Dimension::Token(size) => size.px(),
            Dimension::Px(side) => side,
        };
        let color = self.color.unwrap_or_else(|| window.text_style().color);
        let ring = move |turn: f32| {
            canvas(
                |_, _, _| {},
                move |bounds, _, window, _| {
                    if let Some(path) = spinner_arc(bounds, turn) {
                        window.paint_path(path, color);
                    }
                },
            )
            .size_full()
        };
        let still = reduced_motion(cx);
        let spinner = div()
            .id(self.id.clone())
            .test_support()
            .flex_shrink_0()
            .size(px(side))
            .when_some(self.label, |spinner, label| {
                spinner.role(Role::Status).aria_label(label)
            });
        if still {
            return spinner.child(ring(0.)).into_any_element();
        }
        spinner
            .child(div().size_full().with_animation(
                self.id,
                Animation::new(SPINNER_TURN).repeat(),
                move |this, delta| this.child(ring(delta)),
            ))
            .into_any_element()
    }
}

// ---------------------------------------------------------------------------------------------
// LinearProgress

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ProgressTone {
    #[default]
    Accent,
    Positive,
    Danger,
}

impl ProgressTone {
    pub const ALL: [ProgressTone; 3] = [
        ProgressTone::Accent,
        ProgressTone::Positive,
        ProgressTone::Danger,
    ];

    pub fn name(self) -> &'static str {
        ["accent", "positive", "danger"][self as usize]
    }
}

/// The share of the track the sliding bar covers.
const INDETERMINATE_SHARE: f32 = 0.4;

/// A value held to 0 to 100, NaN as 0.
pub fn clamp_percent(value: f32) -> f32 {
    if value.is_nan() {
        0.
    } else {
        value.clamp(0., 100.)
    }
}

/// A thin progress bar: `value` is 0 to 100, or `None` while indeterminate. Under reduced motion
/// the sliding bar is a full, dimmed bar, which reads as "busy" and not as a number.
#[derive(IntoElement)]
pub struct LinearProgress {
    id: ElementId,
    value: Option<f32>,
    label: SharedString,
    tone: ProgressTone,
    on: Option<Surface>,
}

impl LinearProgress {
    pub fn new(
        id: impl Into<ElementId>,
        value: Option<f32>,
        label: impl Into<SharedString>,
    ) -> Self {
        Self {
            id: id.into(),
            value,
            label: label.into(),
            tone: ProgressTone::Accent,
            on: None,
        }
    }

    pub fn tone(mut self, tone: ProgressTone) -> Self {
        self.tone = tone;
        self
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }
}

impl RenderOnce for LinearProgress {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let colour = match self.tone {
            ProgressTone::Accent => sem.role.accent,
            ProgressTone::Positive => sem.role.positive,
            ProgressTone::Danger => sem.role.danger,
        };
        let percent = self.value.map(clamp_percent);
        let bar = div().absolute().top_0().h_full().rounded_full().bg(colour);
        let track = div()
            .id(self.id.clone())
            .test_support()
            .role(Role::ProgressIndicator)
            .aria_label(self.label)
            .aria_min_numeric_value(0.)
            .aria_max_numeric_value(100.)
            .when_some(percent, |track, percent| {
                track.aria_numeric_value(f64::from(percent))
            })
            .relative()
            .w_full()
            .h(px(SPACE_XS))
            .overflow_hidden()
            .rounded_full()
            .bg(rail_fill(sem, Surface::or_current(self.on, cx)));
        let bar = match percent {
            Some(percent) => bar.left_0().w(relative(percent / 100.)).into_any_element(),
            None if reduced_motion(cx) => bar
                .left_0()
                .w_full()
                .opacity(STATE_DISABLED)
                .into_any_element(),
            None => bar
                .w(relative(INDETERMINATE_SHARE))
                .with_animation(
                    self.id,
                    Animation::new(Duration::from_millis(u64::from(4 * MOTION_SLOW_MS))).repeat(),
                    // From just off the left edge to just past the right.
                    |bar, delta| {
                        bar.left(relative(
                            -INDETERMINATE_SHARE + delta * (1. + INDETERMINATE_SHARE),
                        ))
                    },
                )
                .into_any_element(),
        };
        track.child(bar)
    }
}

// ---------------------------------------------------------------------------------------------
// Skeleton

/// `control.*`: a rect skeleton's height, 32, 40 or 48 px.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ControlHeight {
    Sm,
    Md,
    #[default]
    Lg,
}

impl ControlHeight {
    pub fn px(self) -> f32 {
        match self {
            ControlHeight::Sm => CONTROL_SM,
            ControlHeight::Md => CONTROL_MD,
            ControlHeight::Lg => CONTROL_LG,
        }
    }
}

/// Most text lines a skeleton draws.
pub const MAX_SKELETON_LINES: usize = 20;

enum SkeletonShape {
    Lines(usize),
    Block {
        width: Length,
        height: f32,
        radius: f32,
    },
}

/// Placeholder shapes for content that is loading: text lines, a circle, a rect. Hidden from
/// assistive technology: pair it with a named status elsewhere. Pulses unless motion is off.
#[derive(IntoElement)]
pub struct Skeleton {
    key: ElementId,
    shape: SkeletonShape,
    on: Option<Surface>,
}

impl Skeleton {
    /// `lines` lines of body text, 1 to 20 (anything else is held to that range).
    pub fn text(key: impl Into<ElementId>, lines: usize) -> Self {
        Self {
            key: key.into(),
            shape: SkeletonShape::Lines(lines.clamp(1, MAX_SKELETON_LINES)),
            on: None,
        }
    }

    /// An avatar-sized circle (or, the old screens, a side in px).
    pub fn circle(key: impl Into<ElementId>, size: impl Into<Dimension<AvatarSize>>) -> Self {
        let side = size.into().side();
        Self {
            key: key.into(),
            shape: SkeletonShape::Block {
                width: px(side).into(),
                height: side,
                radius: RADIUS_FULL,
            },
            on: None,
        }
    }

    /// A full-width block a control high.
    pub fn rect(key: impl Into<ElementId>, height: ControlHeight) -> Self {
        Self {
            key: key.into(),
            shape: SkeletonShape::Block {
                width: relative(1.).into(),
                height: height.px(),
                radius: RADIUS_CARD,
            },
            on: None,
        }
    }

    /// The old screens' block of their own size.
    pub fn sized(key: impl Into<ElementId>, width: impl Into<Length>, height: f32) -> Self {
        Self {
            key: key.into(),
            shape: SkeletonShape::Block {
                width: width.into(),
                height,
                radius: RADIUS_SM,
            },
            on: None,
        }
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }
}

impl RenderOnce for Skeleton {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colour = stand_out_fill(cx.sem(), Surface::or_current(self.on, cx));
        let shape = match self.shape {
            SkeletonShape::Lines(lines) => div().w_full().flex().flex_col().children(
                // One line of body text each, the bar inset in it.
                (0..lines).map(|_| {
                    div()
                        .h(px(tokens::TEXT_BODY.line_height))
                        .flex()
                        .items_center()
                        .child(
                            div()
                                .w_full()
                                .h(px(tokens::TEXT_BODY.line_height - 2. * SPACE_XS))
                                .rounded(px(RADIUS_SM))
                                .bg(colour),
                        )
                }),
            ),
            SkeletonShape::Block {
                width,
                height,
                radius,
            } => div()
                .flex_shrink_0()
                .w(width)
                .h(px(height))
                .rounded(px(radius))
                .bg(colour),
        };
        if reduced_motion(cx) {
            return shape.into_any_element();
        }
        shape
            .with_animation(
                self.key,
                Animation::new(Duration::from_millis(u64::from(4 * MOTION_SLOW_MS)))
                    .repeat()
                    .with_easing(pulsating_between(STATE_DISABLED, 1.)),
                |shape, delta| shape.opacity(delta),
            )
            .into_any_element()
    }
}

// ---------------------------------------------------------------------------------------------
// Alert and Toast

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Info,
    Success,
    Warning,
    Danger,
}

impl Severity {
    pub const ALL: [Severity; 4] = [
        Severity::Info,
        Severity::Success,
        Severity::Warning,
        Severity::Danger,
    ];

    pub fn name(self) -> &'static str {
        ["info", "success", "warning", "danger"][self as usize]
    }

    /// The icon and its colour.
    fn mark(self, sem: &Sem) -> (LoungeIcon, Hsla) {
        match self {
            Severity::Info => (LoungeIcon::Info, sem.role.accent_text),
            Severity::Success => (LoungeIcon::CircleCheck, sem.role.positive),
            Severity::Warning => (LoungeIcon::TriangleAlert, sem.role.warning),
            Severity::Danger => (LoungeIcon::CircleAlert, sem.role.danger),
        }
    }
}

/// The ARIA role of a notice: urgent ones interrupt as `alert`, the rest wait as `status`, and one
/// that does not announce (already on the page when it loads) is a quiet `note`.
pub fn live_role(urgent: bool, announce: bool) -> Role {
    match (announce, urgent) {
        (false, _) => Role::Note,
        (true, true) => Role::Alert,
        (true, false) => Role::Status,
    }
}

fn live_of(role: Role) -> Option<Live> {
    match role {
        Role::Alert => Some(Live::Assertive),
        Role::Status => Some(Live::Polite),
        _ => None,
    }
}

type Handler = Rc<dyn Fn(&mut Window, &mut App)>;

/// A text button in an alert or a toast.
fn action_button(id: SharedString, label: SharedString, handler: Handler) -> Button {
    Button::new(ElementId::Name(id), label)
        .text()
        .size(ButtonSize::Sm)
        .on_click(move |_, window, cx| handler(window, cx))
}

fn dismiss_button(id: SharedString, handler: Handler) -> IconButton {
    IconButton::new(ElementId::Name(id), IconName::Close, "Dismiss")
        .small()
        .on_click(move |_, window, cx| handler(window, cx))
}

/// The side padding of a small text button (`ControlSize::Sm.padding()`, the web's
/// `BUTTON_PADDING.sm`): Alert pulls its actions back by it, so the label lines up with the text
/// above.
const BUTTON_PADDING_SM: f32 = SPACE_MD;
/// What a small icon button has around its icon.
const CLOSE_INSET: f32 = (CONTROL_SM - ICON_SM) / 2.;

/// An inline message banner that belongs to a place on the page. Warnings and dangers interrupt
/// (`alert`); info and success wait (`status`); `announce(false)` makes it a quiet `note`.
#[derive(IntoElement)]
pub struct Alert {
    id: ElementId,
    severity: Severity,
    title: Option<SharedString>,
    message: SharedString,
    action: Option<(SharedString, Handler)>,
    secondary_action: Option<(SharedString, Handler)>,
    on_close: Option<Handler>,
    announce: bool,
    on: Option<Surface>,
}

impl Alert {
    /// `id` is required, as on Toast: its buttons' ids are made from it, so two alerts under one
    /// parent never share theirs.
    pub fn new(
        id: impl Into<ElementId>,
        severity: Severity,
        message: impl Into<SharedString>,
    ) -> Self {
        Self {
            id: id.into(),
            severity,
            title: None,
            message: message.into(),
            action: None,
            secondary_action: None,
            on_close: None,
            announce: true,
            on: None,
        }
    }

    /// A bold first line.
    pub fn title(mut self, title: impl Into<SharedString>) -> Self {
        self.title = Some(title.into());
        self
    }

    /// One action, a text button under the message.
    pub fn action(
        mut self,
        label: impl Into<SharedString>,
        handler: impl Fn(&mut Window, &mut App) + 'static,
    ) -> Self {
        self.action = Some((label.into(), Rc::new(handler)));
        self
    }

    /// A second text button beside `action`, for a choice (Join and Decline). It is not a
    /// dismiss: that is `on_close`.
    pub fn secondary_action(
        mut self,
        label: impl Into<SharedString>,
        handler: impl Fn(&mut Window, &mut App) + 'static,
    ) -> Self {
        self.secondary_action = Some((label.into(), Rc::new(handler)));
        self
    }

    /// Adds a Dismiss button.
    pub fn on_close(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_close = Some(Rc::new(handler));
        self
    }

    /// Speak when it appears (default). `false` for one already on the page when it loads.
    pub fn announce(mut self, announce: bool) -> Self {
        self.announce = announce;
        self
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }
}

/// An alert's or a toast's accessible name: the title, then the message.
fn notice_label(title: Option<&SharedString>, message: &SharedString) -> SharedString {
    match title {
        Some(title) => format!("{title}. {message}").into(),
        None => message.clone(),
    }
}

impl RenderOnce for Alert {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let (icon, tone) = self.severity.mark(sem);
        let role = live_role(
            matches!(self.severity, Severity::Warning | Severity::Danger),
            self.announce,
        );
        let base = self.id.to_string();
        let actions: Vec<Button> = [
            self.action
                .map(|(label, handler)| (label, handler, "action")),
            self.secondary_action
                .map(|(label, handler)| (label, handler, "secondary-action")),
        ]
        .into_iter()
        .flatten()
        .map(|(label, handler, name)| {
            action_button(format!("{base}-{name}").into(), label, handler)
        })
        .collect();
        let body = div()
            .flex_1()
            .min_w_0()
            .flex()
            .flex_col()
            .children(self.title.clone().map(|title| {
                div()
                    .font_weight(FontWeight(f32::from(tokens::TEXT_BODY_STRONG.weight)))
                    .child(title)
            }))
            .child(div().child(self.message.clone()))
            .when(!actions.is_empty(), |body| {
                body.child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap_x(px(SPACE_SM))
                        .gap_y(px(SPACE_XS))
                        .mt(px(SPACE_SM))
                        .ml(px(-BUTTON_PADDING_SM))
                        .max_w_full()
                        .children(actions.into_iter().map(|button| {
                            div().min_w_0().max_w_full().overflow_hidden().child(button)
                        })),
                )
            });
        let close = self.on_close.map(|handler| {
            div()
                .flex_shrink_0()
                .mt(px(-(CONTROL_SM - tokens::TEXT_BODY.line_height) / 2.))
                .mr(px(-CLOSE_INSET))
                .child(dismiss_button(format!("{base}-dismiss").into(), handler))
        });
        div()
            .id(self.id)
            .test_support()
            .role(role)
            .aria_label(notice_label(self.title.as_ref(), &self.message))
            .when_some(live_of(role), |alert, live| alert.aria_live(live))
            .w_full()
            .flex()
            .items_start()
            .gap(px(SPACE_MD))
            .p(px(SPACE_LG))
            .rounded(px(RADIUS_CARD))
            .bg(stand_out_fill(sem, Surface::or_current(self.on, cx)))
            .text_color(sem.role.text)
            .font_family(FONT_FAMILY)
            .text_size(px(tokens::TEXT_BODY.size))
            .line_height(px(tokens::TEXT_BODY.line_height))
            .child(
                div()
                    .flex()
                    .flex_shrink_0()
                    .items_center()
                    .h(px(tokens::TEXT_BODY.line_height))
                    .child(Icon::lounge(icon).size(ICON_LG).color(tone)),
            )
            .child(body)
            .children(close)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ToastTone {
    #[default]
    Neutral,
    Positive,
    Danger,
}

impl ToastTone {
    pub const ALL: [ToastTone; 3] = [ToastTone::Neutral, ToastTone::Positive, ToastTone::Danger];

    pub fn name(self) -> &'static str {
        ["neutral", "positive", "danger"][self as usize]
    }
}

/// The floating notice's frame, shared by Toast and the old screens' Snackbar.
fn toast_frame(sem: &Sem) -> Div {
    div()
        .occlude()
        .flex()
        .items_center()
        .gap(px(SPACE_MD))
        .max_w_full()
        .py(px(SPACE_MD))
        .px(px(SPACE_LG))
        .border(px(BORDER_HAIRLINE))
        .border_color(sem.role.hairline)
        .rounded(px(RADIUS_CARD))
        .bg(sem.role.surface)
        .text_color(sem.role.text)
        .shadow(super::overlays::shadow(
            sem,
            super::overlays::ShadowKind::Overlay,
        ))
        .font_family(FONT_FAMILY)
        .text_size(px(tokens::TEXT_BODY.size))
        .line_height(px(tokens::TEXT_BODY.line_height))
}

/// One floating notice about something that just happened. Presentational only: where it appears,
/// how long it stays and how notices queue belong to the behaviour layer. A `danger` toast
/// interrupts; the others wait.
#[derive(IntoElement)]
pub struct Toast {
    id: ElementId,
    message: SharedString,
    tone: ToastTone,
    action: Option<(SharedString, Handler)>,
    on_close: Option<Handler>,
    announce: bool,
    /// A child for the surface tests.
    #[cfg(test)]
    probe: Option<AnyElement>,
}

impl Toast {
    /// A child after the message, for the surface tests.
    #[cfg(test)]
    pub(crate) fn probe(mut self, element: impl IntoElement) -> Self {
        self.probe = Some(element.into_any_element());
        self
    }

    pub fn new(id: impl Into<ElementId>, message: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            message: message.into(),
            tone: ToastTone::Neutral,
            action: None,
            on_close: None,
            announce: true,
            #[cfg(test)]
            probe: None,
        }
    }

    /// `positive` and `danger` add an icon.
    pub fn tone(mut self, tone: ToastTone) -> Self {
        self.tone = tone;
        self
    }

    /// One action, a text button such as "Undo".
    pub fn action(
        mut self,
        label: impl Into<SharedString>,
        handler: impl Fn(&mut Window, &mut App) + 'static,
    ) -> Self {
        self.action = Some((label.into(), Rc::new(handler)));
        self
    }

    /// Adds a Dismiss button.
    pub fn on_close(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_close = Some(Rc::new(handler));
        self
    }

    pub fn announce(mut self, announce: bool) -> Self {
        self.announce = announce;
        self
    }
}

impl RenderOnce for Toast {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let mark = match self.tone {
            ToastTone::Neutral => None,
            ToastTone::Positive => Some((LoungeIcon::CircleCheck, sem.role.positive)),
            ToastTone::Danger => Some((LoungeIcon::CircleAlert, sem.role.danger)),
        };
        let role = live_role(self.tone == ToastTone::Danger, self.announce);
        let base = self.id.to_string();
        // A floating panel: what it holds draws on the surface, wherever it was opened from.
        let toast = toast_frame(sem)
            .id(self.id)
            .test_support()
            .role(role)
            .aria_label(self.message.clone())
            .when_some(live_of(role), |toast, live| toast.aria_live(live))
            .children(mark.map(|(icon, tone)| Icon::lounge(icon).size(ICON_LG).color(tone)))
            .child(div().flex_1().min_w_0().child(self.message))
            .map(|toast| {
                #[cfg(test)]
                let toast = toast.children(self.probe);
                toast
            })
            .children(self.action.map(|(label, handler)| {
                div().flex_shrink_0().child(action_button(
                    format!("{base}-action").into(),
                    label,
                    handler,
                ))
            }))
            .children(self.on_close.map(|handler| {
                div()
                    .flex_shrink_0()
                    .child(dismiss_button(format!("{base}-dismiss").into(), handler))
            }));
        SurfaceScope::new(Surface::Surface, toast)
    }
}

/// The old screens' snackbar: a [`Toast`]'s look around their own action. The owner decides when
/// it goes away.
#[derive(IntoElement)]
pub struct Snackbar {
    message: SharedString,
    action: Option<AnyElement>,
}

impl Snackbar {
    pub fn new(message: impl Into<SharedString>) -> Self {
        Self {
            message: message.into(),
            action: None,
        }
    }

    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.action = Some(action.into_any_element());
        self
    }
}

impl RenderOnce for Snackbar {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        SurfaceScope::new(
            Surface::Surface,
            toast_frame(cx.sem())
                .justify_between()
                .child(div().flex_1().min_w_0().child(self.message))
                .children(self.action),
        )
    }
}
