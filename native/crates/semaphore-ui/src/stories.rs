//! The story registry. A story is a view plus the data it shows. Each feature directory has its
//! own `stories()`, so units add stories without touching this file or each other's.

use gpui_kit::*;
use semaphore_core::platform::CoreError;
use semaphore_core::scenario::{self, ScenarioViews};
use std::path::PathBuf;

pub type BuildStory = fn(&StoryEnv, &mut Window, &mut App) -> AnyView;

pub struct Story {
    pub name: &'static str,
    pub build: BuildStory,
}

impl Story {
    pub fn new(name: &'static str, build: BuildStory) -> Self {
        Self { name, build }
    }
}

/// What a story may read.
pub struct StoryEnv {
    /// `native/fixtures/scenarios`, from unit U3.
    pub scenarios_dir: PathBuf,
}

impl StoryEnv {
    /// Loads `fixtures/scenarios/<name>.json` as view models.
    pub fn scenario(&self, name: &str) -> Result<ScenarioViews, CoreError> {
        let path = self.scenarios_dir.join(format!("{name}.json"));
        let json = std::fs::read_to_string(&path).map_err(|error| CoreError::Failed {
            message: format!("{}: {error}", path.display()),
        })?;
        scenario::from_json(&json)
    }
}

pub fn all() -> Vec<Story> {
    [
        crate::shell::stories(),
        crate::theme::stories(),
        crate::kit::stories(),
        crate::auth::stories(),
        crate::nav::stories(),
        crate::messages::stories(),
        crate::composer::stories(),
        crate::voice::stories(),
        crate::emoji::stories(),
        crate::panel::stories(),
        crate::thread::stories(),
        crate::dms::stories(),
        crate::friends::stories(),
        crate::notifications::stories(),
        crate::profile::stories(),
        crate::settings::stories(),
        crate::home::stories(),
        crate::player::stories(),
        crate::replay::stories(),
        crate::community_settings::stories(),
        crate::roles::stories(),
        crate::moderation::stories(),
        crate::admin::stories(),
        crate::gifs::stories(),
        crate::shortcuts::stories(),
    ]
    .into_iter()
    .flatten()
    .collect()
}

pub fn find(name: &str) -> Option<Story> {
    all().into_iter().find(|story| story.name == name)
}

/// The window's root: draws whatever the story built.
pub struct StoryRoot {
    pub view: AnyView,
}

impl Render for StoryRoot {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        self.view.clone()
    }
}
