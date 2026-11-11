//! `semaphore://` links: finding them in a launch's arguments, and telling the OS that this app opens
//! them.
//!
//! Nothing here trusts a link. [`from_args`] only picks candidates by prefix and length; the app
//! parses each one with `semaphore_ui::nav::parse_deep_link` and drops what doesn't parse.
//!
//! - **Linux:** a desktop entry with `MimeType=x-scheme-handler/semaphore;` in the user's
//!   applications directory, and our entry as the scheme's default in the user's `mimeapps.list`,
//!   as Electron's `setAsDefaultProtocolClient` does through `xdg-settings`. Skipped when a package
//!   installed an entry with our id, which then owns the registration.
//! - **Windows:** `HKCU\Software\Classes\semaphore` with `URL Protocol` and an open command.

use semaphore_core::platform::CoreError;
use std::path::{Path, PathBuf};

/// The scheme, as the OS registers it.
pub const SCHEME: &str = "semaphore";

/// The desktop entry's id (its file name) and the Wayland app id, which must match for the
/// compositor to find the icon.
pub const APP_ID: &str = "app.semaphorechat.semaphore";

/// Longer is garbage: `deep-link-parser.ts` caps a link at this too.
pub const MAX_LINK_LENGTH: usize = 2048;

/// At most this many links from one launch.
pub const MAX_LINKS: usize = 8;

/// The arguments that look like `semaphore://` links, in order. A prefix check, not validation.
pub fn from_args<S: AsRef<str>>(args: &[S]) -> Vec<String> {
    args.iter()
        .map(AsRef::as_ref)
        .filter(|arg| is_candidate(arg))
        .take(MAX_LINKS)
        .map(str::to_owned)
        .collect()
}

/// Whether a string could be one of our links: our scheme (any case), `://`, and not too long.
pub fn is_candidate(arg: &str) -> bool {
    arg.len() <= MAX_LINK_LENGTH
        && arg
            .get(..SCHEME.len() + 3)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("semaphore://"))
}

/// What to register: the program a link starts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegisterTarget {
    /// The executable; on Linux the AppImage itself when running from one (`$APPIMAGE`).
    pub exe: PathBuf,
    /// Linux: `$XDG_DATA_HOME` (`~/.local/share`).
    pub data_home: PathBuf,
    /// Linux: `$XDG_CONFIG_HOME` (`~/.config`).
    pub config_home: PathBuf,
    /// Linux: `$XDG_DATA_DIRS`, where packages install desktop entries.
    pub data_dirs: Vec<PathBuf>,
}

impl RegisterTarget {
    /// This process, with the XDG directories from the environment. `None` when there's no home
    /// directory or the executable can't be found.
    pub fn from_env() -> Option<Self> {
        let home = directories::BaseDirs::new()?;
        let exe = std::env::var_os("APPIMAGE")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .or_else(|| std::env::current_exe().ok())?;
        let data_dirs = std::env::var_os("XDG_DATA_DIRS")
            .filter(|dirs| !dirs.is_empty())
            .map(|dirs| std::env::split_paths(&dirs).collect())
            .unwrap_or_else(|| vec!["/usr/local/share".into(), "/usr/share".into()]);
        Some(Self {
            exe,
            data_home: home.data_dir().to_path_buf(),
            config_home: home.config_dir().to_path_buf(),
            data_dirs,
        })
    }
}

/// What a registration did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Registered {
    /// Written now, or already as it should be.
    Ours,
    /// A package installed an entry with our id; it owns the registration.
    Packaged(PathBuf),
}

/// Registers the scheme for `target`, writing only what differs. Every start may call it.
pub fn register(target: &RegisterTarget) -> Result<Registered, CoreError> {
    #[cfg(windows)]
    return windows::register(target);
    #[cfg(not(windows))]
    return linux::register(target);
}

/// Who opens `semaphore://` links now, as far as this user's settings say.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkStatus {
    /// Registered for this executable, as `register` would leave it.
    Ours,
    /// A package installed an entry with our id; it owns the registration.
    Packaged(PathBuf),
    /// Another program, or nothing.
    NotOurs,
}

/// Reads who opens `semaphore://` links for `target`, writing nothing.
pub fn status(target: &RegisterTarget) -> Result<LinkStatus, CoreError> {
    #[cfg(windows)]
    return windows::status(target);
    #[cfg(not(windows))]
    return linux::status(target);
}

/// The default handler `mimeapps.list` names for `mime`, if any.
pub fn default_handler(mimeapps: &str, mime: &str) -> Option<String> {
    let mut in_defaults = false;
    for line in mimeapps.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_defaults = line == "[Default Applications]";
            continue;
        }
        if !in_defaults {
            continue;
        }
        if let Some((key, value)) = line.split_once('=')
            && key.trim() == mime
        {
            return value.split(';').next().map(|id| id.trim().to_owned());
        }
    }
    None
}

/// A marker in the desktop entry we write, so a later start knows the file is ours to replace.
pub const GENERATED_KEY: &str = "X-Semaphore-Generated";

/// Quotes one argument of a desktop entry's `Exec` key: double quotes, with `"`, `` ` ``, `$` and
/// `\` escaped, and `%` doubled. The key's value is also a string, whose own escaping is undone
/// first, so every backslash of the quoting is doubled again (the spec's `\\\\` and `\\$`). `None` for a path a desktop entry can't carry (a control character, or not UTF-8).
pub fn exec_arg(path: &Path) -> Option<String> {
    let text = path.to_str()?;
    if text.chars().any(char::is_control) {
        return None;
    }
    let mut quoted = String::from("\"");
    for character in text.chars() {
        match character {
            // `\$`: the string escape leaves `\$`, the Exec quoting then `$`.
            '"' | '`' | '$' => {
                quoted.push_str("\\\\");
                quoted.push(character);
            }
            // Escaped for the Exec quoting, then for the string value: four in the file.
            '\\' => quoted.push_str("\\\\\\\\"),
            '%' => quoted.push_str("%%"),
            other => quoted.push(other),
        }
    }
    quoted.push('"');
    Some(quoted)
}

/// The desktop entry for `exe`.
pub fn desktop_entry(exe: &Path) -> Option<String> {
    let exec = exec_arg(exe)?;
    Some(format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Semaphore\n\
         Comment=Voice and text chat\n\
         Exec={exec} %u\n\
         Icon={APP_ID}\n\
         Terminal=false\n\
         Categories=Network;Chat;InstantMessaging;\n\
         MimeType=x-scheme-handler/{SCHEME};\n\
         StartupWMClass={APP_ID}\n\
         {GENERATED_KEY}=true\n"
    ))
}

/// `mimeapps.list` with `mime=desktop_id` as the default, everything else as it was. `None` when
/// it already says so.
pub fn with_default_handler(existing: &str, mime: &str, desktop_id: &str) -> Option<String> {
    const SECTION: &str = "[Default Applications]";
    let wanted = format!("{mime}={desktop_id}");
    let mut lines: Vec<String> = existing.lines().map(str::to_owned).collect();
    let section = lines.iter().position(|line| line.trim() == SECTION);
    match section {
        Some(start) => {
            let end = lines[start + 1..]
                .iter()
                .position(|line| line.trim_start().starts_with('['))
                .map_or(lines.len(), |offset| start + 1 + offset);
            let existing_key = (start + 1..end).find(|&index| {
                lines[index]
                    .split_once('=')
                    .is_some_and(|(key, _)| key.trim() == mime)
            });
            match existing_key {
                Some(index) if lines[index].trim() == wanted => return None,
                Some(index) => lines[index] = wanted,
                None => {
                    // After the section's last non-blank line.
                    let mut at = end;
                    while at > start + 1 && lines[at - 1].trim().is_empty() {
                        at -= 1;
                    }
                    lines.insert(at, wanted);
                }
            }
        }
        None => {
            if lines.last().is_some_and(|line| !line.trim().is_empty()) {
                lines.push(String::new());
            }
            lines.push(SECTION.to_owned());
            lines.push(wanted);
        }
    }
    let mut out = lines.join("\n");
    out.push('\n');
    Some(out)
}

/// Writes `contents` to `path` through a temp file in the same directory, unless it's already
/// there.
#[cfg(not(windows))]
fn write_if_changed(path: &Path, contents: &[u8]) -> std::io::Result<bool> {
    if std::fs::read(path).is_ok_and(|current| current == contents) {
        return Ok(false);
    }
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir)?;
    let temp = dir.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("file"),
        std::process::id()
    ));
    std::fs::write(&temp, contents)?;
    std::fs::rename(&temp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&temp);
    })?;
    Ok(true)
}

fn failed(what: &str, error: impl std::fmt::Display) -> CoreError {
    CoreError::Failed {
        message: format!("cannot register semaphore:// links: {what}: {error}"),
    }
}

#[cfg(not(windows))]
mod linux {
    use super::*;

    use crate::icon::ICON_PNG;

    pub fn status(target: &RegisterTarget) -> Result<LinkStatus, CoreError> {
        let file_name = format!("{APP_ID}.desktop");
        if let Some(packaged) = target
            .data_dirs
            .iter()
            .map(|dir| dir.join("applications").join(&file_name))
            .find(|path| path.is_file())
        {
            return Ok(LinkStatus::Packaged(packaged));
        }
        let mimeapps = match std::fs::read_to_string(target.config_home.join("mimeapps.list")) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(error) => return Err(failed("mimeapps.list", error)),
        };
        if default_handler(&mimeapps, &format!("x-scheme-handler/{SCHEME}")).as_deref()
            != Some(file_name.as_str())
        {
            return Ok(LinkStatus::NotOurs);
        }
        // Our id is the default: ours if the entry starts this executable.
        let entry = std::fs::read_to_string(target.data_home.join("applications").join(&file_name))
            .unwrap_or_default();
        let wanted = desktop_entry(&target.exe).unwrap_or_default();
        let exec = |text: &str| {
            text.lines()
                .find(|line| line.starts_with("Exec="))
                .map(str::to_owned)
        };
        Ok(if exec(&entry).is_some() && exec(&entry) == exec(&wanted) {
            LinkStatus::Ours
        } else {
            LinkStatus::NotOurs
        })
    }

    pub fn register(target: &RegisterTarget) -> Result<Registered, CoreError> {
        let file_name = format!("{APP_ID}.desktop");
        if let Some(packaged) = target
            .data_dirs
            .iter()
            .map(|dir| dir.join("applications").join(&file_name))
            .find(|path| path.is_file())
        {
            return Ok(Registered::Packaged(packaged));
        }
        let entry_path = target.data_home.join("applications").join(&file_name);
        // A file with our id that we didn't write (the user's own, say) stays; it only loses the
        // default if it doesn't claim the scheme, which is then still ours to set.
        let foreign = std::fs::read_to_string(&entry_path)
            .is_ok_and(|text| !text.contains(&format!("{GENERATED_KEY}=true")));
        if !foreign {
            let entry = desktop_entry(&target.exe)
                .ok_or_else(|| failed("the executable's path", "not a valid desktop entry path"))?;
            write_if_changed(&entry_path, entry.as_bytes())
                .map_err(|error| failed("the desktop entry", error))?;
            let icon = target
                .data_home
                .join("icons/hicolor/512x512/apps")
                .join(format!("{APP_ID}.png"));
            write_if_changed(&icon, ICON_PNG).map_err(|error| failed("the icon", error))?;
        }
        let mimeapps = target.config_home.join("mimeapps.list");
        let existing = match std::fs::read_to_string(&mimeapps) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(error) => return Err(failed("mimeapps.list", error)),
        };
        if let Some(updated) =
            with_default_handler(&existing, &format!("x-scheme-handler/{SCHEME}"), &file_name)
        {
            write_if_changed(&mimeapps, updated.as_bytes())
                .map_err(|error| failed("mimeapps.list", error))?;
        }
        Ok(Registered::Ours)
    }
}

/// The registry values for the scheme, as `(subkey of HKCU, value name or "" for the default,
/// data)`. Plain data, so it's tested anywhere.
pub fn registry_values(exe: &Path) -> Vec<(String, String, String)> {
    let base = format!(r"Software\Classes\{SCHEME}");
    let exe = exe.display();
    vec![
        (base.clone(), String::new(), "URL:Semaphore".into()),
        (base.clone(), "URL Protocol".into(), String::new()),
        (
            format!(r"{base}\DefaultIcon"),
            String::new(),
            format!("\"{exe}\",0"),
        ),
        (
            format!(r"{base}\shell\open\command"),
            String::new(),
            format!("\"{exe}\" \"%1\""),
        ),
    ]
}

#[cfg(windows)]
mod windows {
    use super::*;
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
        RegCloseKey, RegCreateKeyExW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
    };

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }

    fn read(key: HKEY, name: &[u16]) -> Option<Vec<u16>> {
        let mut size = 0u32;
        let mut kind = 0u32;
        // SAFETY: a size query with no buffer.
        let status = unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                std::ptr::null(),
                &mut kind,
                std::ptr::null_mut(),
                &mut size,
            )
        };
        if status != ERROR_SUCCESS || kind != REG_SZ {
            return None;
        }
        let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
        // SAFETY: `buffer` holds `size` bytes.
        let status = unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                std::ptr::null(),
                &mut kind,
                buffer.as_mut_ptr().cast(),
                &mut size,
            )
        };
        (status == ERROR_SUCCESS).then_some(buffer)
    }

    /// Ours when every value `register` writes is there with its data.
    pub fn status(target: &RegisterTarget) -> Result<LinkStatus, CoreError> {
        for (subkey, name, data) in registry_values(&target.exe) {
            let subkey_w = wide(&subkey);
            let mut key: HKEY = std::ptr::null_mut();
            // SAFETY: a valid string, and `key` is closed below.
            let status = unsafe {
                RegOpenKeyExW(
                    HKEY_CURRENT_USER,
                    subkey_w.as_ptr(),
                    0,
                    KEY_QUERY_VALUE,
                    &mut key,
                )
            };
            if status != ERROR_SUCCESS {
                return Ok(LinkStatus::NotOurs);
            }
            let data_w = wide(&data);
            let same = read(key, &wide(&name)).is_some_and(|current| {
                current
                    .iter()
                    .take_while(|&&c| c != 0)
                    .eq(data_w.iter().take_while(|&&c| c != 0))
            });
            // SAFETY: opened above.
            unsafe { RegCloseKey(key) };
            if !same {
                return Ok(LinkStatus::NotOurs);
            }
        }
        Ok(LinkStatus::Ours)
    }

    pub fn register(target: &RegisterTarget) -> Result<Registered, CoreError> {
        for (subkey, name, data) in registry_values(&target.exe) {
            let subkey_w = wide(&subkey);
            let mut key: HKEY = std::ptr::null_mut();
            // SAFETY: valid strings, and `key` is closed below.
            let status = unsafe {
                RegCreateKeyExW(
                    HKEY_CURRENT_USER,
                    subkey_w.as_ptr(),
                    0,
                    std::ptr::null(),
                    REG_OPTION_NON_VOLATILE,
                    KEY_SET_VALUE | KEY_QUERY_VALUE,
                    std::ptr::null(),
                    &mut key,
                    std::ptr::null_mut(),
                )
            };
            if status != ERROR_SUCCESS {
                return Err(failed(&subkey, format!("RegCreateKeyExW {status}")));
            }
            let name_w = wide(&name);
            let data_w = wide(&data);
            let status = if read(key, &name_w).is_some_and(|current| {
                current
                    .iter()
                    .take_while(|&&c| c != 0)
                    .eq(data_w.iter().take_while(|&&c| c != 0))
            }) {
                ERROR_SUCCESS
            } else {
                // SAFETY: `data_w` is `len * 2` bytes, NUL included.
                unsafe {
                    RegSetValueExW(
                        key,
                        name_w.as_ptr(),
                        0,
                        REG_SZ,
                        data_w.as_ptr().cast(),
                        (data_w.len() * 2) as u32,
                    )
                }
            };
            // SAFETY: opened above.
            unsafe { RegCloseKey(key) };
            if status != ERROR_SUCCESS {
                return Err(failed(&subkey, format!("RegSetValueExW {status}")));
            }
        }
        Ok(Registered::Ours)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_handler_is_read_from_the_defaults_section_only() {
        let text = "[Added Associations]\nx-scheme-handler/semaphore=other.desktop;\n\n[Default Applications]\ntext/html=firefox.desktop\nx-scheme-handler/semaphore = app.semaphorechat.semaphore.desktop;old.desktop\n";
        assert_eq!(
            default_handler(text, "x-scheme-handler/semaphore").as_deref(),
            Some("app.semaphorechat.semaphore.desktop")
        );
        assert_eq!(default_handler(text, "x-scheme-handler/http"), None);
        assert_eq!(default_handler("", "x-scheme-handler/semaphore"), None);
    }

    #[cfg(not(windows))]
    #[test]
    fn status_reads_what_register_writes_and_writes_nothing() {
        let dir =
            std::env::temp_dir().join(format!("semaphore-links-status-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let target = RegisterTarget {
            exe: dir.join("bin/semaphore-app"),
            data_home: dir.join("data"),
            config_home: dir.join("config"),
            data_dirs: vec![dir.join("system")],
        };
        assert_eq!(status(&target).unwrap(), LinkStatus::NotOurs);
        assert!(!dir.exists(), "status wrote nothing");
        assert_eq!(register(&target).unwrap(), Registered::Ours);
        assert_eq!(status(&target).unwrap(), LinkStatus::Ours);
        // Another build registered under our id: not this executable's.
        let moved = RegisterTarget {
            exe: dir.join("elsewhere/semaphore-app"),
            ..target.clone()
        };
        assert_eq!(status(&moved).unwrap(), LinkStatus::NotOurs);
        // A package's entry owns it.
        let packaged = dir
            .join("system/applications")
            .join(format!("{APP_ID}.desktop"));
        std::fs::create_dir_all(packaged.parent().unwrap()).unwrap();
        std::fs::write(&packaged, "[Desktop Entry]\n").unwrap();
        assert_eq!(status(&target).unwrap(), LinkStatus::Packaged(packaged));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_our_scheme_is_picked_from_the_arguments() {
        let args = [
            "--server",
            "https://chat.example",
            "semaphore://community/x",
            "SEMAPHORE://join/abc",
            "semaphore:/missing-slash",
            "https://semaphore://nope",
            "semaphorex://community/x",
        ];
        assert_eq!(
            from_args(&args),
            vec!["semaphore://community/x", "SEMAPHORE://join/abc"]
        );
    }

    #[test]
    fn oversized_and_too_many_links_are_dropped() {
        let long = format!("semaphore://join/{}", "a".repeat(MAX_LINK_LENGTH));
        assert!(from_args(&[long]).is_empty());
        let many: Vec<String> = (0..20).map(|n| format!("semaphore://join/{n}")).collect();
        assert_eq!(from_args(&many).len(), MAX_LINKS);
        // Multi-byte text right at the prefix boundary doesn't panic.
        assert!(from_args(&["semaphoré://x", "é"]).is_empty());
    }

    #[test]
    fn exec_paths_are_quoted_and_escaped() {
        assert_eq!(
            exec_arg(Path::new("/opt/Semaphore Chat/semaphore")).as_deref(),
            Some("\"/opt/Semaphore Chat/semaphore\"")
        );
        assert_eq!(
            exec_arg(Path::new("/a/$b`c\"d%e")).as_deref(),
            Some("\"/a/\\\\$b\\\\`c\\\\\"d%%e\"")
        );
        assert_eq!(
            exec_arg(Path::new("/a\\b")).as_deref(),
            Some("\"/a\\\\\\\\b\"")
        );
        assert_eq!(exec_arg(Path::new("/a\nb")), None);
    }

    #[test]
    fn the_desktop_entry_claims_the_scheme() {
        let entry = desktop_entry(Path::new("/usr/bin/semaphore-app")).unwrap();
        assert!(
            entry.contains("Exec=\"/usr/bin/semaphore-app\" %u\n"),
            "{entry}"
        );
        assert!(
            entry.contains("MimeType=x-scheme-handler/semaphore;\n"),
            "{entry}"
        );
        assert!(
            entry.contains("StartupWMClass=app.semaphorechat.semaphore\n"),
            "{entry}"
        );
        assert!(entry.contains("X-Semaphore-Generated=true\n"), "{entry}");
    }

    const MIME: &str = "x-scheme-handler/semaphore";
    const ID: &str = "app.semaphorechat.semaphore.desktop";

    #[test]
    fn mimeapps_gains_a_section_when_it_has_none() {
        assert_eq!(
            with_default_handler("", MIME, ID).unwrap(),
            "[Default Applications]\nx-scheme-handler/semaphore=app.semaphorechat.semaphore.desktop\n"
        );
        assert_eq!(
            with_default_handler("[Added Associations]\ntext/plain=a.desktop;", MIME, ID).unwrap(),
            "[Added Associations]\ntext/plain=a.desktop;\n\n[Default Applications]\n\
             x-scheme-handler/semaphore=app.semaphorechat.semaphore.desktop\n"
        );
    }

    #[test]
    fn mimeapps_keeps_other_defaults_and_replaces_ours() {
        let existing = "[Default Applications]\ntext/html=firefox.desktop\n\
                        x-scheme-handler/semaphore=old.desktop\n\n[Added Associations]\nimage/png=a.desktop;\n";
        assert_eq!(
            with_default_handler(existing, MIME, ID).unwrap(),
            "[Default Applications]\ntext/html=firefox.desktop\n\
             x-scheme-handler/semaphore=app.semaphorechat.semaphore.desktop\n\n\
             [Added Associations]\nimage/png=a.desktop;\n"
        );
        let added = with_default_handler(
            "[Default Applications]\ntext/html=firefox.desktop\n\n[Other]\nx=y\n",
            MIME,
            ID,
        )
        .unwrap();
        assert_eq!(
            added,
            "[Default Applications]\ntext/html=firefox.desktop\n\
             x-scheme-handler/semaphore=app.semaphorechat.semaphore.desktop\n\n[Other]\nx=y\n"
        );
    }

    #[test]
    fn mimeapps_that_already_says_so_is_left_alone() {
        let existing = "[Default Applications]\nx-scheme-handler/semaphore=app.semaphorechat.semaphore.desktop\n";
        assert_eq!(with_default_handler(existing, MIME, ID), None);
    }

    #[test]
    fn the_registry_values_open_the_exe_with_the_link() {
        let values = registry_values(Path::new(r"C:\Program Files\Semaphore\semaphore-app.exe"));
        assert!(values.contains(&(
            r"Software\Classes\semaphore".into(),
            "URL Protocol".into(),
            String::new()
        )));
        assert!(values.contains(&(
            r"Software\Classes\semaphore\shell\open\command".into(),
            String::new(),
            r#""C:\Program Files\Semaphore\semaphore-app.exe" "%1""#.into()
        )));
    }

    #[cfg(not(windows))]
    mod linux {
        use super::super::*;

        fn target(root: &Path) -> RegisterTarget {
            RegisterTarget {
                exe: "/opt/semaphore/semaphore-app".into(),
                data_home: root.join("data"),
                config_home: root.join("config"),
                data_dirs: vec![root.join("system")],
            }
        }

        fn temp_root(name: &str) -> PathBuf {
            let root =
                std::env::temp_dir().join(format!("semaphore-links-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(&root).unwrap();
            root
        }

        #[test]
        fn registering_writes_the_entry_icon_and_default_then_nothing() {
            let root = temp_root("fresh");
            let target = target(&root);
            assert_eq!(register(&target).unwrap(), Registered::Ours);
            let entry_path = root.join("data/applications/app.semaphorechat.semaphore.desktop");
            let entry = std::fs::read_to_string(&entry_path).unwrap();
            assert!(entry.contains("Exec=\"/opt/semaphore/semaphore-app\" %u"));
            assert!(
                root.join("data/icons/hicolor/512x512/apps/app.semaphorechat.semaphore.png")
                    .is_file()
            );
            let mimeapps = std::fs::read_to_string(root.join("config/mimeapps.list")).unwrap();
            assert!(
                mimeapps.contains("x-scheme-handler/semaphore=app.semaphorechat.semaphore.desktop")
            );

            let before = std::fs::metadata(&entry_path).unwrap().modified().unwrap();
            assert_eq!(register(&target).unwrap(), Registered::Ours);
            assert_eq!(
                std::fs::metadata(&entry_path).unwrap().modified().unwrap(),
                before
            );

            // A moved AppImage rewrites the entry.
            let moved = RegisterTarget {
                exe: "/home/u/Apps/Semaphore.AppImage".into(),
                ..target
            };
            register(&moved).unwrap();
            assert!(
                std::fs::read_to_string(&entry_path)
                    .unwrap()
                    .contains("Semaphore.AppImage")
            );
            std::fs::remove_dir_all(&root).unwrap();
        }

        #[test]
        fn a_packaged_entry_owns_the_registration() {
            let root = temp_root("packaged");
            let packaged = root.join("system/applications/app.semaphorechat.semaphore.desktop");
            std::fs::create_dir_all(packaged.parent().unwrap()).unwrap();
            std::fs::write(&packaged, "[Desktop Entry]\n").unwrap();
            assert_eq!(
                register(&target(&root)).unwrap(),
                Registered::Packaged(packaged)
            );
            assert!(!root.join("data").exists());
            assert!(!root.join("config").exists());
            std::fs::remove_dir_all(&root).unwrap();
        }

        #[test]
        fn a_users_own_entry_is_kept_but_the_default_is_set() {
            let root = temp_root("foreign");
            let entry_path = root.join("data/applications/app.semaphorechat.semaphore.desktop");
            std::fs::create_dir_all(entry_path.parent().unwrap()).unwrap();
            std::fs::write(&entry_path, "[Desktop Entry]\nExec=mine %u\n").unwrap();
            register(&target(&root)).unwrap();
            assert_eq!(
                std::fs::read_to_string(&entry_path).unwrap(),
                "[Desktop Entry]\nExec=mine %u\n"
            );
            assert!(
                std::fs::read_to_string(root.join("config/mimeapps.list"))
                    .unwrap()
                    .contains("semaphore")
            );
            std::fs::remove_dir_all(&root).unwrap();
        }
    }
}
