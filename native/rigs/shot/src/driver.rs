//! Driving one offscreen window through GPUI's real renderer: what every rig step that isn't about
//! stories needs. `rig-shot` uses it for stories, and `rig-slice` for the real app.

use crate::script::Step;
use anyhow::{Context as _, Result, anyhow, bail};
use gpui_kit::test::{TestQueryExt as _, TestWindowExt as _};
use gpui_kit::*;
use image::RgbaImage;
use std::path::Path;
use std::sync::Arc;

/// `wait idle` gives up after this many rounds. Reaching it means something redraws forever.
const IDLE_ROUNDS: usize = 50;

pub struct Driver {
    pub cx: HeadlessAppContext,
    pub window: Option<AnyWindowHandle>,
}

impl Driver {
    /// A headless app on the real text system and the headless renderer, serving `assets`.
    pub fn new(assets: Arc<dyn AssetSource>) -> Self {
        let cx = HeadlessAppContext::with_platform(
            gpui_kit::platform::current_platform(true).text_system(),
            assets,
            gpui_kit::platform::current_headless_renderer,
        );
        Self { cx, window: None }
    }

    pub fn update(&mut self, action: impl FnOnce(&mut Window, &mut App)) -> Result<()> {
        let window = self.window.ok_or_else(|| anyhow!("no window is open"))?;
        self.cx
            .update_window(window, |_, window, cx| action(window, cx))
            .context("updating the window")
    }

    pub fn query<R: Default>(&mut self, read: impl FnOnce(&Window) -> R) -> Result<R> {
        let mut result = R::default();
        self.update(|window, _| result = read(window))?;
        Ok(result)
    }

    /// Prints the roles and names GPUI's accessibility layer has, and fails on a control with no name.
    pub fn audit(&mut self) -> Result<()> {
        let lines: Vec<(String, String, bool)> = self.query(|window| {
            window
                .elements()
                .iter()
                .map(|element| {
                    let role = element
                        .role()
                        .map(|role| format!("{role:?}"))
                        .unwrap_or_default();
                    let mut label = element.label().unwrap_or_default().to_owned();
                    if element.focused() == Some(true) {
                        label.push_str(" [focused]");
                    }
                    let nameless = !role.is_empty() && element.label().is_none();
                    (role, label, nameless)
                })
                .collect()
        })?;
        let nameless = lines.iter().filter(|(_, _, bad)| *bad).count();
        println!(
            "audit: {} elements, {nameless} with a role and no name",
            lines.len()
        );
        for (role, label, bad) in &lines {
            if *bad {
                println!("  nameless {role}");
            } else {
                println!("  {role}: {label}");
            }
        }
        if nameless > 0 {
            bail!("{nameless} controls have no accessible name");
        }
        Ok(())
    }

    /// Runs what's queued and draws a frame, for a step that needs the current layout.
    pub fn settle(&mut self) -> Result<()> {
        self.cx.run_until_parked();
        self.update(|window, cx| window.render_frame(cx))
    }

    /// Until nothing's queued and two frames in a row have the same pixels. GPUI has no public "is
    /// this window dirty", and pixels are what a screenshot cares about anyway.
    pub fn wait_idle(&mut self) -> Result<RgbaImage> {
        let window = self.window.ok_or_else(|| anyhow!("no window is open"))?;
        let mut last: Option<RgbaImage> = None;
        for _ in 0..IDLE_ROUNDS {
            self.settle()?;
            let image = self
                .cx
                .capture_screenshot(window)
                .context("offscreen rendering is unavailable")?;
            if last
                .as_ref()
                .is_some_and(|last| last.as_raw() == image.as_raw())
            {
                return Ok(image);
            }
            last = Some(image);
        }
        bail!("the window was still changing after {IDLE_ROUNDS} frames");
    }

    pub fn shot(&mut self, out: &Path) -> Result<()> {
        let image = self.wait_idle()?;
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }
        image
            .save(out)
            .with_context(|| format!("writing {}", out.display()))?;
        println!("{} {}x{}", out.display(), image.width(), image.height());
        Ok(())
    }

    /// Runs a step that needs nothing but the window. False for a step this doesn't know.
    pub fn run_generic(&mut self, step: &Step, out_dir: &Path) -> Result<bool> {
        match step {
            Step::Click { id, at } => {
                self.settle()?;
                let target = ElementId::Name(id.clone().into());
                self.update(|window, cx| match at {
                    Some((x, y)) => window.click_at(target, point(px(*x), px(*y)), cx),
                    None => window.click(target, cx),
                })?;
            }
            Step::Drag { from, to } => {
                self.settle()?;
                self.update(|window, cx| {
                    window.drag(point(px(from.0), px(from.1)), point(px(to.0), px(to.1)), cx);
                })?;
            }
            Step::Press { key } => self.update(|window, cx| window.press(key, cx))?,
            Step::Type { text } => {
                self.settle()?;
                self.update(|window, cx| window.input(text, cx))?;
            }
            Step::WaitIdle => {
                self.wait_idle()?;
            }
            Step::Shot { name } => self.shot(&out_dir.join(format!("{name}.png")))?,
            Step::ExpectLabel { label } => {
                self.settle()?;
                if !self.has_label(label)? {
                    bail!("expected an element named {label:?}");
                }
            }
            Step::ExpectNoLabel { label } => {
                self.settle()?;
                if self.has_label(label)? {
                    bail!("expected no element named {label:?}");
                }
            }
            Step::ExpectFocused { label } => {
                self.settle()?;
                let focused = self.query(|window| {
                    window
                        .find_all_by_label(label)
                        .iter()
                        .any(|element| element.focused() == Some(true))
                })?;
                if !focused {
                    bail!("expected {label:?} to have keyboard focus");
                }
            }
            Step::Audit => {
                self.settle()?;
                self.audit()?;
            }
            Step::Story { .. } | Step::Theme { .. } | Step::Emit(_) => return Ok(false),
        }
        Ok(true)
    }

    pub fn has_label(&mut self, label: &str) -> Result<bool> {
        self.query(|window| !window.find_all_by_label(label).is_empty())
    }
}
