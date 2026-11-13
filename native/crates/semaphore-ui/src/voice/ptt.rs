//! The push-to-talk key's rule, ported from `frontend/src/hooks/usePushToTalk.ts`: a keydown
//! starts transmitting, a keyup stops it, repeats and editable targets are ignored, and losing the
//! window's focus while the key is held releases it. The app binds the events; this decides what
//! each one does, so the table below is the whole behaviour.
//!
//! Keys are GPUI's names, lowercased (`"f13"`, `"space"`), as `settings::key_capture` stores them.

/// One thing that happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PttInput<'a> {
    /// A key was pressed. `repeat` is the platform's auto-repeat flag (`KeyDownEvent::is_held`).
    Down { key: &'a str, repeat: bool },
    /// A key was released, whether or not the press was ours.
    Up { key: &'a str },
    /// The window lost the OS's focus, as the web's `blur` does.
    FocusLost,
    /// The saved key or the input mode changed in settings while the key may be held: the web's
    /// listener is re-bound then, and its cleanup releases the microphone.
    SettingsChanged,
}

/// What is true when the event arrives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PttContext<'a> {
    /// The configured key, lowercased; `None` until one is set.
    pub key: Option<&'a str>,
    /// In a call (`VoiceStatus::Connected`).
    pub connected: bool,
    /// The input mode is push-to-talk.
    pub push_to_talk: bool,
    /// The room lets us send the microphone (not server-muted, SPEAK held).
    pub can_speak: bool,
    /// A text field has focus: the web checks the event's target instead.
    pub editable: bool,
    /// Our microphone is open because the key is down.
    pub held: bool,
}

/// What to do about it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PttAction {
    Start,
    Stop,
    Nothing,
}

/// The web's rule, in one place. `key` and `input`'s keys are compared as given (lowercase).
pub fn decide(input: PttInput<'_>, ctx: PttContext<'_>) -> PttAction {
    match input {
        // Typing wins over talking, as the web's `tagName` check does. A repeat is one held key,
        // not a new press.
        PttInput::Down { key, repeat } => {
            let ours = ctx.key.is_some_and(|configured| configured == key);
            if ours
                && !repeat
                && !ctx.editable
                && ctx.connected
                && ctx.push_to_talk
                && ctx.can_speak
                && !ctx.held
            {
                PttAction::Start
            } else {
                PttAction::Nothing
            }
        }
        // Only our key's release stops it: another key's must not.
        PttInput::Up { key } => {
            if ctx.held && ctx.key.is_some_and(|configured| configured == key) {
                PttAction::Stop
            } else {
                PttAction::Nothing
            }
        }
        PttInput::FocusLost | PttInput::SettingsChanged => {
            if ctx.held {
                PttAction::Stop
            } else {
                PttAction::Nothing
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn ctx() -> PttContext<'static> {
        PttContext {
            key: Some("f13"),
            connected: true,
            push_to_talk: true,
            can_speak: true,
            editable: false,
            held: false,
        }
    }

    #[test]
    fn the_rule_is_the_webs() {
        struct Case {
            what: &'static str,
            input: PttInput<'static>,
            ctx: PttContext<'static>,
            want: PttAction,
        }
        let down = |key, repeat| PttInput::Down { key, repeat };
        let up = |key| PttInput::Up { key };
        let cases = [
            Case {
                what: "the configured key starts it",
                input: down("f13", false),
                ctx: ctx(),
                want: PttAction::Start,
            },
            Case {
                what: "another key does nothing",
                input: down("f12", false),
                ctx: ctx(),
                want: PttAction::Nothing,
            },
            Case {
                what: "no key set means nothing",
                input: down("f13", false),
                ctx: PttContext { key: None, ..ctx() },
                want: PttAction::Nothing,
            },
            Case {
                what: "an auto-repeat is not a new press",
                input: down("f13", true),
                ctx: ctx(),
                want: PttAction::Nothing,
            },
            Case {
                what: "a text field has focus",
                input: down("f13", false),
                ctx: PttContext {
                    editable: true,
                    ..ctx()
                },
                want: PttAction::Nothing,
            },
            Case {
                what: "not connected to voice",
                input: down("f13", false),
                ctx: PttContext {
                    connected: false,
                    ..ctx()
                },
                want: PttAction::Nothing,
            },
            Case {
                what: "voice activity is the mode",
                input: down("f13", false),
                ctx: PttContext {
                    push_to_talk: false,
                    ..ctx()
                },
                want: PttAction::Nothing,
            },
            Case {
                what: "server-muted, or no SPEAK",
                input: down("f13", false),
                ctx: PttContext {
                    can_speak: false,
                    ..ctx()
                },
                want: PttAction::Nothing,
            },
            Case {
                what: "already held",
                input: down("f13", false),
                ctx: PttContext {
                    held: true,
                    ..ctx()
                },
                want: PttAction::Nothing,
            },
            Case {
                what: "the held key's release stops it",
                input: up("f13"),
                ctx: PttContext {
                    held: true,
                    ..ctx()
                },
                want: PttAction::Stop,
            },
            Case {
                what: "another key's release doesn't",
                input: up("f12"),
                ctx: PttContext {
                    held: true,
                    ..ctx()
                },
                want: PttAction::Nothing,
            },
            Case {
                what: "a release with nothing held",
                input: up("f13"),
                ctx: ctx(),
                want: PttAction::Nothing,
            },
            Case {
                what: "losing focus while held releases",
                input: PttInput::FocusLost,
                ctx: PttContext {
                    held: true,
                    ..ctx()
                },
                want: PttAction::Stop,
            },
            Case {
                what: "losing focus with nothing held",
                input: PttInput::FocusLost,
                ctx: ctx(),
                want: PttAction::Nothing,
            },
            Case {
                what: "the key changed in settings while held",
                input: PttInput::SettingsChanged,
                ctx: PttContext {
                    key: Some("space"),
                    held: true,
                    ..ctx()
                },
                want: PttAction::Stop,
            },
            Case {
                what: "settings changed with nothing held",
                input: PttInput::SettingsChanged,
                ctx: PttContext {
                    key: Some("space"),
                    ..ctx()
                },
                want: PttAction::Nothing,
            },
        ];
        for case in cases {
            assert_eq!(decide(case.input, case.ctx), case.want, "{}", case.what);
        }
    }
}
