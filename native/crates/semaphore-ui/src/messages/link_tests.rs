//! No message link reaches the OS except as `check_link`'s address, through `MessageText`'s
//! `on_link` or `check_link` itself.
//!
//! A source check over every `.rs` file under `semaphore-ui/src` and `semaphore-app/src`, read at
//! test time, so a file added later is checked too. Test code (`tests.rs`, `*_tests.rs`,
//! `tests_*.rs`, and a file's trailing `#[cfg(test)] mod`) is left out. Comments are left out only
//! where `//` starts outside a string, so `"https://"` hides nothing after it.
//!
//! - In the UI nothing calls `open_url`, `is_web_url`, `link_parts` or `extract_urls`, and
//!   `MessageListEvent::OpenLink` is built in exactly two places in `messages/row.rs`: from
//!   `check_link`'s `link.href`, and from the `href` that `MessageText`'s and `LinkCard`'s
//!   `on_link` hand over (the checked address). `LinkCard` hands over only `check_link`'s.
//! - In the app, `open_url(` appears only in the files listed in `APP_OPENERS`, and a message link
//!   opens in one place, `conversation/actions.rs`, as `check_link`'s address.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::prelude::rust_2024::test;

/// Files of the app that may call `open_url(`, and how many times: the opener itself and the
/// screens whose links are the app's own (About, onboarding, sign-in in the browser, the admin
/// dashboard, the update notice), plus the one place a message link opens.
const APP_OPENERS: &[(&str, usize)] = &[
    ("lib.rs", 2),
    ("root.rs", 1),
    ("root/about.rs", 1),
    ("root/onboarding.rs", 1),
    ("root/u9.rs", 1),
    ("root/admin.rs", 1),
    ("root/update.rs", 1),
    ("conversation/actions.rs", 1),
];

fn is_test_file(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    name == "tests.rs" || name.ends_with("_tests.rs") || name.starts_with("tests_")
}

/// One line without its `//` comment, where the comment starts outside a string literal.
fn strip_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut in_string = false;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' if in_string => i += 1,
            b'"' => in_string = !in_string,
            // A char literal holding a quote: `'"'`.
            b'\''
                if !in_string
                    && bytes.get(i + 1) == Some(&b'"')
                    && bytes.get(i + 2) == Some(&b'\'') =>
            {
                i += 2
            }
            b'/' if !in_string && bytes.get(i + 1) == Some(&b'/') => return &line[..i],
            _ => {}
        }
        i += 1;
    }
    line
}

/// The source as checked: without a trailing test module and without comments.
fn code(source: &str) -> String {
    let source = source
        .split("\n#[cfg(test)]\nmod ")
        .next()
        .unwrap_or_default();
    source
        .lines()
        .map(strip_comment)
        .collect::<Vec<_>>()
        .join("\n")
}

/// Every `OpenLink { ... }` struct literal in `code`, on one line.
fn open_links(code: &str) -> Vec<String> {
    code.match_indices("OpenLink {")
        .map(|(at, _)| {
            let literal = code[at..].split('}').next().unwrap_or_default();
            literal.split_whitespace().collect::<Vec<_>>().join(" ")
        })
        .collect()
}

/// What is wrong with these sources: UI files and app files, by path relative to `src/`.
fn violations(ui: &[(String, String)], app: &[(String, String)]) -> Vec<String> {
    let mut found = Vec::new();
    let mut emitted = Vec::new();
    for (path, source) in ui {
        if is_test_file(path) {
            continue;
        }
        let code = code(source);
        for call in ["open_url(", "is_web_url(", "link_parts(", "extract_urls("] {
            if code.contains(call) {
                found.push(format!("ui/{path} calls `{call}`"));
            }
        }
        for literal in open_links(&code) {
            match path.as_str() {
                "messages/view.rs" if literal == "OpenLink { url: String," => {}
                "messages/row.rs" => emitted.push(literal),
                _ => found.push(format!("ui/{path} builds `{literal}`")),
            }
        }
    }
    let allowed = [
        "OpenLink { url: link.href",
        "OpenLink { url: href.to_owned(),",
    ];
    for literal in &emitted {
        if !allowed.contains(&literal.as_str()) {
            found.push(format!(
                "ui/messages/row.rs builds `{literal}`: not a checked address"
            ));
        }
    }
    if emitted.len() != 2 {
        found.push(format!(
            "ui/messages/row.rs builds OpenLink {} times, not 2",
            emitted.len()
        ));
    }
    let row = ui
        .iter()
        .find(|(path, _)| path == "messages/row.rs")
        .map(|(_, source)| code(source))
        .unwrap_or_default();
    for needle in [
        "if let Some(link) = check_link(url)",
        ".on_link(move |href, _, cx| link_shared.open_href(href, cx))",
    ] {
        if !row.contains(needle) {
            found.push(format!("ui/messages/row.rs lacks `{needle}`"));
        }
    }
    // A preview card (`LinkCard`) hands its `on_link` only `check_link`'s address, and opens
    // nothing itself.
    let card = ui
        .iter()
        .find(|(path, _)| path == "kit/chat/link_card.rs")
        .map(|(_, source)| code(source))
        .unwrap_or_default();
    for needle in [
        "let link = check_link(&self.href)",
        "let href = link.href;",
        "handler(&href, window, cx)",
    ] {
        if !card.contains(needle) {
            found.push(format!("ui/kit/chat/link_card.rs lacks `{needle}`"));
        }
    }
    if card.matches("handler(").count() != 1 {
        found.push("ui/kit/chat/link_card.rs calls its handler more than once".into());
    }

    let openers: BTreeMap<&str, usize> = APP_OPENERS.iter().copied().collect();
    for (path, source) in app {
        if is_test_file(path) {
            continue;
        }
        let code = code(source);
        let calls = code.matches("open_url(").count();
        let allowed = openers.get(path.as_str()).copied().unwrap_or(0);
        if calls != allowed {
            found.push(format!(
                "app/{path} calls `open_url(` {calls} times, allowed {allowed}"
            ));
        }
        if code.contains("MessageListEvent::OpenLink") && path != "conversation/actions.rs" {
            found.push(format!("app/{path} handles OpenLink"));
        }
        if path == "conversation/actions.rs" {
            for needle in [
                "MessageListEvent::OpenLink { url } => self.open_link(url, window, cx)",
                "Some(checked) => crate::open_url(&checked.href, cx)",
            ] {
                if !code.contains(needle) {
                    found.push(format!("app/{path} lacks `{needle}`"));
                }
            }
            if code.contains("is_web_url(") {
                found.push(format!("app/{path} calls `is_web_url(`"));
            }
        }
    }
    found
}

fn sources(root: &Path) -> Vec<(String, String)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).expect("reading the sources") {
            let path = entry.expect("a directory entry").path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                out.push(path);
            }
        }
    }
    let mut paths = Vec::new();
    walk(root, &mut paths);
    paths.sort();
    paths
        .into_iter()
        .map(|path| {
            let relative = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            (relative, std::fs::read_to_string(&path).unwrap())
        })
        .collect()
}

/// Source files by path relative to `src/`.
type Sources = Vec<(String, String)>;

fn tree() -> (Sources, Sources) {
    let ui = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let app = Path::new(env!("CARGO_MANIFEST_DIR")).join("../semaphore-app/src");
    (sources(&ui), sources(&app))
}

#[test]
fn message_links_open_only_as_checked() {
    let (ui, app) = tree();
    assert!(ui.len() > 100 && app.len() > 20, "read the whole tree");
    assert_eq!(violations(&ui, &app), Vec::<String>::new());
}

/// The two ways past the old fixed-list check: a new file, and a line with a `"https://"` before
/// the call. Both are caught now.
#[test]
fn the_check_sees_new_files_and_code_after_a_url_literal() {
    let (mut ui, app) = tree();
    ui.push((
        "messages/zz_probe.rs".into(),
        "fn f(url: &str) { emit(MessageListEvent::OpenLink { url: url.to_owned() }); }".into(),
    ));
    let found = violations(&ui, &app);
    assert!(
        found.iter().any(|v| v.contains("zz_probe.rs builds")),
        "{found:?}"
    );

    let (mut ui, app) = tree();
    let row = ui
        .iter_mut()
        .find(|(path, _)| path == "messages/row.rs")
        .unwrap();
    row.1.push_str(
        "\nfn probe(url: &str) { if url.starts_with(\"https://\") { self.emit(MessageListEvent::OpenLink { url: url.to_owned() }, cx); } }\n",
    );
    let found = violations(&ui, &app);
    assert!(
        found.iter().any(|v| v.contains("not a checked address")),
        "{found:?}"
    );

    let (ui, mut app) = tree();
    app.push((
        "root/zz_probe.rs".into(),
        "fn f(cx: &mut App) { crate::open_url(\"x\", cx); }".into(),
    ));
    let found = violations(&ui, &app);
    assert!(
        found.iter().any(|v| v.contains("root/zz_probe.rs calls")),
        "{found:?}"
    );
}

#[test]
fn comments_are_cut_outside_strings_only() {
    assert_eq!(strip_comment("let a = 1; // note"), "let a = 1; ");
    assert_eq!(
        strip_comment("if u.starts_with(\"https://\") { open_url(u) }"),
        "if u.starts_with(\"https://\") { open_url(u) }"
    );
    assert_eq!(strip_comment("let q = '\"'; // x"), "let q = '\"'; ");
    assert_eq!(strip_comment("\"a\\\"//b\" // c"), "\"a\\\"//b\" ");
}
