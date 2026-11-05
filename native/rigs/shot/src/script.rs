//! The step language: one step a line, `#` comments, double quotes around anything with spaces.
//!
//! ```text
//! story shell-unread 1440 900 dark-blue-balanced    # opens a window on a story
//! theme light-blue-balanced                         # switches theme, live
//! click channel-channel-13                          # by element id, with real hit testing
//! click members-scrim 20 400                        # at an offset from its top left
//! drag 360 400 600 400                              # window-local, through real hit testing
//! type "hello there"                                # text to whatever has focus
//! press enter
//! emit connection offline                           # the CoreEvent core would send
//! emit unread help-desk 9 2                         # changes the fixture, then ViewChanged
//! emit message general liam "hi"                    # ListOp::Insert into MessagesChanged
//! emit join-voice Hangout                           # changes the fixture, then ViewChanged
//! wait idle                                         # until nothing's queued and the frame is clean
//! shot unread-desktop-dark                          # <out dir>/<name>.png
//! expect label "Direct Messages"                    # fails unless that accessible name exists
//! expect no-label "Members"                         # fails if it does
//! expect focused "Username"                         # fails unless it has keyboard focus
//! audit                                             # roles and names; fails on a nameless control
//! ```

#[derive(Debug, Clone, PartialEq)]
pub enum Emit {
    Connection {
        state: String,
    },
    Unread {
        channel: String,
        unread: u32,
        mentions: u32,
    },
    Message {
        channel: String,
        author: String,
        text: String,
    },
    JoinVoice {
        channel: String,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    Story {
        name: String,
        width: f32,
        height: f32,
        theme: String,
    },
    Theme {
        name: String,
    },
    Click {
        id: String,
        at: Option<(f32, f32)>,
    },
    Drag {
        from: (f32, f32),
        to: (f32, f32),
    },
    Type {
        text: String,
    },
    Press {
        key: String,
    },
    Emit(Emit),
    WaitIdle,
    Shot {
        name: String,
    },
    ExpectLabel {
        label: String,
    },
    ExpectNoLabel {
        label: String,
    },
    ExpectFocused {
        label: String,
    },
    Audit,
}

/// Splits on spaces, keeping double-quoted runs whole. A `#` outside quotes ends the line.
fn words(line: &str) -> Result<Vec<String>, String> {
    let mut words = Vec::new();
    let mut chars = line.chars().peekable();
    while let Some(&c) = chars.peek() {
        match c {
            ' ' | '\t' => {
                chars.next();
            }
            '#' => break,
            '"' => {
                chars.next();
                let mut word = String::new();
                loop {
                    match chars.next() {
                        Some('"') => break,
                        Some('\\') => word.extend(chars.next()),
                        Some(c) => word.push(c),
                        None => return Err("unterminated quote".into()),
                    }
                }
                words.push(word);
            }
            _ => {
                let mut word = String::new();
                while let Some(&c) = chars.peek() {
                    if c == ' ' || c == '\t' {
                        break;
                    }
                    word.push(c);
                    chars.next();
                }
                words.push(word);
            }
        }
    }
    Ok(words)
}

fn step(words: &[&str]) -> Result<Step, String> {
    let number = |value: &str, what: &str| {
        value
            .parse::<u32>()
            .map_err(|_| format!("{what} must be a number, not {value}"))
    };
    Ok(match words {
        ["story", name, width, height, theme] => Step::Story {
            name: (*name).into(),
            width: number(width, "width")? as f32,
            height: number(height, "height")? as f32,
            theme: (*theme).into(),
        },
        ["theme", name] => Step::Theme {
            name: (*name).into(),
        },
        ["click", id] => Step::Click {
            id: (*id).into(),
            at: None,
        },
        ["click", id, x, y] => Step::Click {
            id: (*id).into(),
            at: Some((number(x, "x")? as f32, number(y, "y")? as f32)),
        },
        ["drag", x1, y1, x2, y2] => Step::Drag {
            from: (number(x1, "x")? as f32, number(y1, "y")? as f32),
            to: (number(x2, "x")? as f32, number(y2, "y")? as f32),
        },
        ["type", text] => Step::Type {
            text: (*text).into(),
        },
        ["press", key] => Step::Press { key: (*key).into() },
        ["emit", "connection", state] => Step::Emit(Emit::Connection {
            state: (*state).into(),
        }),
        ["emit", "unread", channel, unread, mentions] => Step::Emit(Emit::Unread {
            channel: (*channel).into(),
            unread: number(unread, "unread")?,
            mentions: number(mentions, "mentions")?,
        }),
        ["emit", "message", channel, author, text] => Step::Emit(Emit::Message {
            channel: (*channel).into(),
            author: (*author).into(),
            text: (*text).into(),
        }),
        ["emit", "join-voice", channel] => Step::Emit(Emit::JoinVoice {
            channel: (*channel).into(),
        }),
        ["wait", "idle"] => Step::WaitIdle,
        ["expect", "label", label] => Step::ExpectLabel {
            label: (*label).into(),
        },
        ["expect", "no-label", label] => Step::ExpectNoLabel {
            label: (*label).into(),
        },
        ["expect", "focused", label] => Step::ExpectFocused {
            label: (*label).into(),
        },
        ["audit"] => Step::Audit,
        ["shot", name] => Step::Shot {
            name: (*name).into(),
        },
        _ => return Err(format!("not a step: {}", words.join(" "))),
    })
}

pub fn parse(source: &str) -> Result<Vec<Step>, String> {
    let mut steps = Vec::new();
    for (index, line) in source.lines().enumerate() {
        let parts = words(line).map_err(|error| format!("line {}: {error}", index + 1))?;
        if parts.is_empty() {
            continue;
        }
        let parts: Vec<&str> = parts.iter().map(String::as_str).collect();
        steps.push(step(&parts).map_err(|error| format!("line {}: {error}", index + 1))?);
    }
    Ok(steps)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_step() {
        let steps = parse(
            r#"
            # a comment
            story shell-unread 1440 900 dark-blue-balanced
            theme light-teal-minimal  # trailing comment
            click channel-1
            type "hello # there"
            press enter
            emit connection offline
            emit unread help-desk 9 2
            emit message general liam "hi \"you\""
            emit join-voice Hangout
            wait idle
            shot out-1
            expect label "A name"
            expect no-label B
            expect focused C
            audit
            "#,
        )
        .unwrap();
        assert_eq!(steps.len(), 15);
        assert_eq!(
            steps[3],
            Step::Type {
                text: "hello # there".into()
            }
        );
        assert_eq!(
            steps[7],
            Step::Emit(Emit::Message {
                channel: "general".into(),
                author: "liam".into(),
                text: "hi \"you\"".into(),
            })
        );
    }

    #[test]
    fn rejects_what_it_doesnt_know() {
        assert!(parse("sleep 3").unwrap_err().contains("line 1"));
        assert!(parse("click").is_err());
        assert!(parse("type \"open").unwrap_err().contains("unterminated"));
        assert!(parse("story a x 1 dark-teal-minimal").is_err());
    }
}
