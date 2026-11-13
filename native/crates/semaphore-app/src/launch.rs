//! The launch's arguments: links, `--server <url>` and the after-update flag.
//!
//! A link comes from the OS, which puts it in the registered command (`"exe" -- "%1"` on Windows,
//! `%u` in the Linux desktop entry), so a link is untrusted text that may try to look like more
//! than one argument. Two rules keep it from adding options:
//!
//! - everything after `--` is a link candidate or ignored, never an option;
//! - whenever a launch carries a link, every other argument is ignored: a link click starts or
//!   reaches the app with that link and nothing else.

use semaphore_platform_desktop::links;

/// What a launch asked for.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Launch {
    /// `semaphore://` link candidates, in order (parsed later; see `links::is_candidate`).
    pub links: Vec<String>,
    /// `--server <url>`.
    pub server_url: Option<String>,
    /// Started by "Restart to update" (`update::AFTER_UPDATE_FLAG`).
    pub after_update: bool,
}

/// The arguments don't make a launch: print the usage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Usage;

/// Reads a launch's arguments (without the program name).
pub fn parse(args: &[String]) -> Result<Launch, Usage> {
    let (options, after_dashes) = match args.iter().position(|arg| arg == "--") {
        Some(at) => (&args[..at], &args[at + 1..]),
        None => (args, &[][..]),
    };
    let links: Vec<String> = options
        .iter()
        .chain(after_dashes)
        .filter(|arg| links::is_candidate(arg))
        .take(links::MAX_LINKS)
        .cloned()
        .collect();
    if !links.is_empty() || !after_dashes.is_empty() {
        // A link launch (or what the OS registered for one): nothing else counts.
        return Ok(Launch {
            links,
            ..Launch::default()
        });
    }
    let (after_update, rest): (Vec<&String>, Vec<&String>) = options
        .iter()
        .partition(|arg| *arg == crate::update::AFTER_UPDATE_FLAG);
    let server_url = match rest.as_slice() {
        [] => None,
        [flag, url] if *flag == "--server" => Some((*url).clone()),
        _ => return Err(Usage),
    };
    Ok(Launch {
        links,
        server_url,
        after_update: !after_update.is_empty(),
    })
}

#[cfg(test)]
mod tests {
    use super::{Launch, Usage, parse};

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| (*arg).to_owned()).collect()
    }

    #[test]
    fn options_parse_as_before() {
        assert_eq!(parse(&[]), Ok(Launch::default()));
        assert_eq!(
            parse(&args(&["--server", "https://chat.example.org"])),
            Ok(Launch {
                server_url: Some("https://chat.example.org".into()),
                ..Launch::default()
            })
        );
        assert_eq!(
            parse(&args(&["--after-update", "--server", "https://x"])),
            Ok(Launch {
                server_url: Some("https://x".into()),
                after_update: true,
                ..Launch::default()
            })
        );
        assert_eq!(parse(&args(&["--server"])), Err(Usage));
        assert_eq!(parse(&args(&["--bogus"])), Err(Usage));
    }

    #[test]
    fn a_link_launch_takes_only_links() {
        // What Windows runs for `"exe" -- "%1"`.
        assert_eq!(
            parse(&args(&["--", "semaphore://join/abc"])),
            Ok(Launch {
                links: vec!["semaphore://join/abc".into()],
                ..Launch::default()
            })
        );
        // A link that closed the old `"exe" "%1"` quoting early to add an option: after `--`,
        // the option is only ignored text.
        assert_eq!(
            parse(&args(&[
                "--",
                "semaphore://x",
                "--server",
                "https://evil.example"
            ])),
            Ok(Launch {
                links: vec!["semaphore://x".into()],
                ..Launch::default()
            })
        );
        // Without `--` too: a link present means nothing else counts.
        assert_eq!(
            parse(&args(&[
                "semaphore://x",
                "--server",
                "https://evil.example",
                "--after-update"
            ])),
            Ok(Launch {
                links: vec!["semaphore://x".into()],
                ..Launch::default()
            })
        );
        // Whatever follows `--` is never an option or a usage error.
        assert_eq!(
            parse(&args(&["--", "--server", "https://evil.example"])),
            Ok(Launch::default())
        );
        assert_eq!(parse(&args(&["--", "--version"])), Ok(Launch::default()));
    }
}
