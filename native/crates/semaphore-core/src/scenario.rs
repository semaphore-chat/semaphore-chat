//! Exported Ladle scenarios as view models, for stories. Behind the `fixtures` feature.
//! Unit U3 owns this file and fills in `from_json`; see `native/docs/slice-units/U3-scenarios.md`.

use crate::model::{ChannelRow, CommunityRow, Conversation, MessageRow, UserView, VoiceView};
use crate::platform::CoreError;

/// Everything a story can render, already in view-model form.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ScenarioViews {
    pub me: UserView,
    pub communities: Vec<CommunityRow>,
    /// All communities' channels, in display order.
    pub channels: Vec<ChannelRow>,
    /// Oldest first in each conversation.
    pub messages: Vec<(Conversation, Vec<MessageRow>)>,
    pub voice: VoiceView,
}

pub fn from_json(_json: &str) -> Result<ScenarioViews, CoreError> {
    Err(CoreError::Unavailable {
        what: "scenario::from_json, unit U3".into(),
    })
}
