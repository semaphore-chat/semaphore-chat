//! Mark-of-the-Web: files the app writes from a server are marked as coming from the internet.
//!
//! On Windows that is the `Zone.Identifier` alternate data stream with `ZoneId=3` (the Internet
//! zone), the same mark a browser leaves on a download. SmartScreen, the "Open File - Security
//! Warning" prompt and Office's Protected View all read it; a file written without it is trusted
//! as if the user made it. Elsewhere there is no such mark and [`mark_downloaded`] does nothing.

use std::path::{Path, PathBuf};

/// The stream's content: the Internet zone.
pub const ZONE_IDENTIFIER: &str = "[ZoneTransfer]\r\nZoneId=3\r\n";

/// Where the mark for `file` lives: the `Zone.Identifier` stream of the same file.
pub fn zone_identifier_path(file: &Path) -> PathBuf {
    let mut stream = file.as_os_str().to_owned();
    stream.push(":Zone.Identifier");
    PathBuf::from(stream)
}

/// Marks `file` (already written) as downloaded from the internet. `Err` when the mark could not
/// be written (a volume without alternate streams, such as FAT32), in which case the caller must
/// not hand the file to the OS's opener.
pub fn mark_downloaded(file: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        std::fs::write(zone_identifier_path(file), ZONE_IDENTIFIER)
    }
    #[cfg(not(windows))]
    {
        let _ = file;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_mark_is_the_internet_zone() {
        assert_eq!(ZONE_IDENTIFIER, "[ZoneTransfer]\r\nZoneId=3\r\n");
    }

    #[test]
    fn the_mark_is_a_stream_of_the_file_itself() {
        assert_eq!(
            zone_identifier_path(Path::new(r"C:\Users\u\AppData\open\f1-clip.mp4")),
            PathBuf::from(r"C:\Users\u\AppData\open\f1-clip.mp4:Zone.Identifier")
        );
        assert_eq!(
            zone_identifier_path(Path::new("/data/open/f1-a b.mp4")),
            PathBuf::from("/data/open/f1-a b.mp4:Zone.Identifier")
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn elsewhere_marking_writes_nothing() {
        let dir = tempdir();
        let file = dir.join("clip.mp4");
        std::fs::write(&file, b"x").unwrap();
        mark_downloaded(&file).unwrap();
        let names: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("clip.mp4")]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn on_windows_the_stream_is_written_and_reads_back() {
        let dir = tempdir();
        let file = dir.join("clip.mp4");
        std::fs::write(&file, b"x").unwrap();
        mark_downloaded(&file).unwrap();
        assert_eq!(
            std::fs::read_to_string(zone_identifier_path(&file)).unwrap(),
            ZONE_IDENTIFIER
        );
        // The file's own bytes are untouched.
        assert_eq!(std::fs::read(&file).unwrap(), b"x");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn tempdir() -> PathBuf {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "download-mark-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}
