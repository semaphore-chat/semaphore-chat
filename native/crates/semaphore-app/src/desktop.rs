//! The window's life on the desktop: where it opens, what's remembered about it.
//!
//! - **Placement:** the size and maximized state from the settings, and the position where the
//!   compositor lets a client choose one (not Wayland). A position no display shows any more (a
//!   monitor unplugged) is dropped and the window centred, as Electron does.
//! - **Saving:** the normal (unmaximized) bounds, half a second after the last change and when the
//!   window closes.

use crate::AppRoot;
use crate::settings::WindowState;
use gpui_kit::*;
use std::time::Duration;

/// The size of a first start.
pub const DEFAULT_SIZE: (f32, f32) = (1280., 800.);
/// Smaller than this is a window nobody meant.
pub const MIN_SIZE: (f32, f32) = (480., 360.);
/// How much of a saved window must be on a display for its position to be kept: a title bar's
/// worth to grab.
const MIN_VISIBLE: (f32, f32) = (100., 40.);
/// How long the bounds must stay put before they're written.
const SAVE_AFTER: Duration = Duration::from_millis(500);

fn rect(x: f32, y: f32, width: f32, height: f32) -> Bounds<Pixels> {
    Bounds {
        origin: point(px(x), px(y)),
        size: size(px(width), px(height)),
    }
}

fn overlap(a: &Bounds<Pixels>, b: &Bounds<Pixels>) -> (f32, f32) {
    let left = f32::from(a.origin.x).max(f32::from(b.origin.x));
    let top = f32::from(a.origin.y).max(f32::from(b.origin.y));
    let right = f32::from(a.origin.x + a.size.width).min(f32::from(b.origin.x + b.size.width));
    let bottom = f32::from(a.origin.y + a.size.height).min(f32::from(b.origin.y + b.size.height));
    ((right - left).max(0.), (bottom - top).max(0.))
}

/// Where the window opens. `displays` are the displays' bounds, the primary first; `positions` is
/// whether the platform places windows where a client asks (not on Wayland).
pub fn placement(
    saved: Option<&WindowState>,
    displays: &[Bounds<Pixels>],
    positions: bool,
) -> WindowBounds {
    let primary = displays.first().copied();
    let (mut width, mut height) = saved.map_or(DEFAULT_SIZE, |state| {
        (state.width as f32, state.height as f32)
    });
    width = width.max(MIN_SIZE.0);
    height = height.max(MIN_SIZE.1);
    if let Some(display) = primary {
        // Never larger than the display it would open on.
        width = width.min(f32::from(display.size.width).max(MIN_SIZE.0));
        height = height.min(f32::from(display.size.height).max(MIN_SIZE.1));
    }
    let kept = saved.filter(|_| positions).and_then(|state| {
        let wanted = rect(state.x as f32, state.y as f32, width, height);
        displays
            .iter()
            .any(|display| {
                let (w, h) = overlap(&wanted, display);
                w >= MIN_VISIBLE.0 && h >= MIN_VISIBLE.1
            })
            .then_some(wanted)
    });
    let bounds = kept.unwrap_or_else(|| match primary {
        Some(display) => rect(
            f32::from(display.origin.x) + (f32::from(display.size.width) - width) / 2.,
            f32::from(display.origin.y) + (f32::from(display.size.height) - height) / 2.,
            width,
            height,
        ),
        None => rect(0., 0., width, height),
    });
    if saved.is_some_and(|state| state.maximized) {
        WindowBounds::Maximized(bounds)
    } else {
        WindowBounds::Windowed(bounds)
    }
}

/// What to remember of the window: its normal bounds, and whether it's maximized. A fullscreen
/// window remembers the bounds it returns to, as not maximized.
pub fn remembered(bounds: WindowBounds) -> WindowState {
    let (normal, maximized) = match bounds {
        WindowBounds::Windowed(normal) => (normal, false),
        WindowBounds::Maximized(normal) => (normal, true),
        WindowBounds::Fullscreen(normal) => (normal, false),
    };
    WindowState {
        x: f32::from(normal.origin.x).round() as i32,
        y: f32::from(normal.origin.y).round() as i32,
        width: f32::from(normal.size.width).round().max(1.) as u32,
        height: f32::from(normal.size.height).round().max(1.) as u32,
        maximized,
    }
}

/// Whether windows go where the client asks on this platform.
pub fn platform_places_windows(cx: &App) -> bool {
    cx.compositor_name() != "Wayland"
}

/// The window's opening bounds, from the settings.
pub fn opening_bounds(saved: Option<&WindowState>, cx: &App) -> WindowBounds {
    let mut displays: Vec<Bounds<Pixels>> = Vec::new();
    if let Some(primary) = cx.primary_display() {
        displays.push(primary.bounds());
    }
    for display in cx.displays() {
        let bounds = display.bounds();
        if !displays.contains(&bounds) {
            displays.push(bounds);
        }
    }
    placement(saved, &displays, platform_places_windows(cx))
}

/// Saves the window's bounds into the app's settings shortly after they stop changing.
pub fn remember_window(app: &Entity<AppRoot>, window: &mut Window, cx: &mut App) {
    app.update(cx, |_, cx| {
        let pending = std::rc::Rc::new(std::cell::Cell::new(0u64));
        cx.observe_window_bounds(window, move |_, window, cx| {
            let generation = pending.get().wrapping_add(1);
            pending.set(generation);
            let pending = pending.clone();
            cx.spawn_in(window, async move |this, cx| {
                cx.background_executor().timer(SAVE_AFTER).await;
                if pending.get() != generation {
                    return; // A later change will save.
                }
                this.update_in(cx, |root, window, _| root.save_window_state(window))
                    .ok();
            })
            .detach();
        })
        .detach();
    });
}

impl AppRoot {
    /// Writes the window's state to the settings, if it changed.
    pub fn save_window_state(&mut self, window: &Window) {
        let state = remembered(window.window_bounds());
        if self.settings().window.as_ref() != Some(&state) {
            self.update_settings(|settings| settings.window = Some(state));
        }
    }
}

#[cfg(test)]
mod tests {
    // Not `super::*`: GPUI's glob brings its own `test` attribute.
    use super::{WindowState, placement, rect, remembered};
    use gpui_kit::{Bounds, Pixels, WindowBounds, px, size};

    fn state(x: i32, y: i32, width: u32, height: u32, maximized: bool) -> WindowState {
        WindowState {
            x,
            y,
            width,
            height,
            maximized,
        }
    }

    const FHD: (f32, f32) = (1920., 1080.);

    fn screens() -> Vec<Bounds<Pixels>> {
        vec![rect(0., 0., FHD.0, FHD.1), rect(1920., 0., 2560., 1440.)]
    }

    #[test]
    fn a_first_start_is_centred_at_the_default_size() {
        assert_eq!(
            placement(None, &screens(), true),
            WindowBounds::Windowed(rect(320., 140., 1280., 800.))
        );
    }

    #[test]
    fn a_saved_window_returns_where_it_was_on_any_display() {
        let saved = state(2100, 200, 1600, 1000, false);
        assert_eq!(
            placement(Some(&saved), &screens(), true),
            WindowBounds::Windowed(rect(2100., 200., 1600., 1000.))
        );
        let maximized = state(10, 20, 1000, 700, true);
        assert_eq!(
            placement(Some(&maximized), &screens(), true),
            WindowBounds::Maximized(rect(10., 20., 1000., 700.))
        );
    }

    #[test]
    fn a_window_on_an_unplugged_display_is_centred() {
        let saved = state(5000, 200, 1000, 700, false);
        assert_eq!(
            placement(Some(&saved), &screens(), true),
            WindowBounds::Windowed(rect(460., 190., 1000., 700.))
        );
        // Only a sliver showing counts as gone too.
        let sliver = state(-990, 100, 1000, 700, false);
        assert!(matches!(
            placement(Some(&sliver), &screens(), true),
            WindowBounds::Windowed(bounds) if bounds.origin.x == px(460.)
        ));
    }

    #[test]
    fn without_client_positions_only_the_size_and_maximized_return() {
        let saved = state(2100, 200, 1600, 1000, true);
        assert_eq!(
            placement(Some(&saved), &screens(), false),
            WindowBounds::Maximized(rect(160., 40., 1600., 1000.))
        );
    }

    #[test]
    fn sizes_are_clamped_to_a_usable_window_on_the_display() {
        let tiny = state(0, 0, 10, 10, false);
        assert!(matches!(
            placement(Some(&tiny), &screens(), true),
            WindowBounds::Windowed(bounds) if bounds.size == size(px(480.), px(360.))
        ));
        let huge = state(0, 0, 9000, 9000, false);
        assert!(matches!(
            placement(Some(&huge), &screens(), true),
            WindowBounds::Windowed(bounds) if bounds.size == size(px(1920.), px(1080.))
        ));
        // No display reported (headless): the saved size at the origin.
        assert_eq!(
            placement(None, &[], true),
            WindowBounds::Windowed(rect(0., 0., 1280., 800.))
        );
    }

    #[test]
    fn the_normal_bounds_are_remembered() {
        assert_eq!(
            remembered(WindowBounds::Maximized(rect(10.4, -20.6, 1000., 700.))),
            state(10, -21, 1000, 700, true)
        );
        assert_eq!(
            remembered(WindowBounds::Fullscreen(rect(0., 0., 800., 600.))),
            state(0, 0, 800, 600, false)
        );
        // What's remembered places the window where it was.
        let back = remembered(WindowBounds::Windowed(rect(300., 200., 900., 640.)));
        assert_eq!(
            placement(Some(&back), &screens(), true),
            WindowBounds::Windowed(rect(300., 200., 900., 640.))
        );
    }
}
