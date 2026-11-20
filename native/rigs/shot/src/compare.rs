//! Comparing the same story as rendered on two sides, for the native UI review.
//!
//! `rig-shot --compare <jobs> --composites <dir> [--fuzz <percent>]` reads a tab-separated jobs
//! file, one line per story and size: `<story> <size> <base> <head> <head2>`. Each of the last
//! three is `absent` (the story does not exist on that side) or a PNG path that must exist; the
//! second head render (`head2`) is what tells a real change from a story that renders
//! non-deterministically. It prints one tab-separated result per job:
//!
//! `<story> <size> <status> <pixels> <total> <percent> <composite|-> <note>`
//!
//! A story that differs between the two head renders is `unstable`, not `changed`: the difference
//! can't be attributed to the change under review. Exits non-zero when any shot could not be
//! compared (a missing or damaged PNG), after printing the results of the ones that could.

use anyhow::{Context as _, Result, bail};
use image::{Rgba, RgbaImage};
use std::fs;
use std::path::{Path, PathBuf};

/// Space between the panels of a composite, in pixels, filled with [`GAP_COLOUR`].
const GAP: u32 = 4;
const GAP_COLOUR: Rgba<u8> = Rgba([0x44, 0x44, 0x44, 0xff]);
/// A differing pixel in the third panel: the after shot, dimmed, where it differs outlined in red.
const MARK: Rgba<u8> = Rgba([0xff, 0x28, 0x28, 0xff]);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Status {
    Changed,
    Unchanged,
    New,
    Removed,
    Unstable,
    Failed,
}

impl Status {
    fn as_str(self) -> &'static str {
        match self {
            Status::Changed => "changed",
            Status::Unchanged => "unchanged",
            Status::New => "new",
            Status::Removed => "removed",
            Status::Unstable => "unstable",
            Status::Failed => "failed",
        }
    }
}

/// One line of the jobs file.
struct Shot {
    story: String,
    size: String,
    base: Side,
    head: Side,
    head2: Side,
}

enum Side {
    /// The story does not exist on this side, so there is nothing to compare against.
    Absent,
    /// A render that must exist; a missing one is a render failure, not a removal.
    Png(PathBuf),
}

impl Side {
    fn parse(field: &str) -> Self {
        match field {
            "absent" => Side::Absent,
            path => Side::Png(PathBuf::from(path)),
        }
    }

    fn path(&self) -> Option<&Path> {
        match self {
            Side::Absent => None,
            Side::Png(path) => Some(path),
        }
    }
}

struct Outcome {
    status: Status,
    pixels: u64,
    total: u64,
    composite: Option<PathBuf>,
    note: String,
}

/// How two renders differ. `identical` means their bytes matched, so no pixels were read.
struct Diff {
    pixels: u64,
    total: u64,
    identical: bool,
    same_size: bool,
}

pub fn run(jobs: &Path, composites: Option<&Path>, fuzz: f64) -> Result<()> {
    if !(0.0..=100.0).contains(&fuzz) {
        bail!("--fuzz takes a percentage of pixels, from 0 to 100");
    }
    let source = fs::read_to_string(jobs).with_context(|| format!("reading {}", jobs.display()))?;
    if let Some(dir) = composites {
        fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    }
    let mut failed = 0usize;
    for (number, line) in source.lines().enumerate() {
        if line.trim().is_empty() || line.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.len() != 5 {
            bail!(
                "{}:{}: expected 5 tab-separated fields, found {}",
                jobs.display(),
                number + 1,
                fields.len()
            );
        }
        let shot = Shot {
            story: fields[0].to_owned(),
            size: fields[1].to_owned(),
            base: Side::parse(fields[2]),
            head: Side::parse(fields[3]),
            head2: Side::parse(fields[4]),
        };
        let outcome = judge(&shot, composites, fuzz).unwrap_or_else(|error| Outcome {
            status: Status::Failed,
            pixels: 0,
            total: 0,
            composite: None,
            note: one_line(&format!("{error:#}")),
        });
        if outcome.status == Status::Failed {
            failed += 1;
        }
        println!(
            "{}\t{}\t{}\t{}\t{}\t{:.4}\t{}\t{}",
            shot.story,
            shot.size,
            outcome.status.as_str(),
            outcome.pixels,
            outcome.total,
            percent(outcome.pixels, outcome.total),
            outcome
                .composite
                .as_ref()
                .map_or_else(|| "-".to_owned(), |path| path.display().to_string()),
            outcome.note
        );
    }
    if failed > 0 {
        bail!("{failed} shot(s) could not be compared");
    }
    Ok(())
}

fn judge(shot: &Shot, composites: Option<&Path>, fuzz: f64) -> Result<Outcome> {
    let (base, head) = (shot.base.path(), shot.head.path());
    match (base, head) {
        (None, None) => Ok(Outcome {
            status: Status::Failed,
            pixels: 0,
            total: 0,
            composite: None,
            note: "neither side rendered this story".into(),
        }),
        (Some(base), None) => {
            let image = load(base)?;
            let composite = composite(composites, shot, &[&image])?;
            Ok(Outcome {
                status: Status::Removed,
                pixels: 0,
                total: pixels(&image),
                composite,
                note: String::new(),
            })
        }
        (None, Some(head)) => {
            let image = load(head)?;
            let composite = composite(composites, shot, &[&image])?;
            Ok(Outcome {
                status: Status::New,
                pixels: 0,
                total: pixels(&image),
                composite,
                note: String::new(),
            })
        }
        (Some(base), Some(head)) => {
            let diff = compare_files(base, head)?;
            let allowed = allowed(diff.total, fuzz);
            let unstable = match shot.head2.path() {
                Some(second) => compare_files(head, second)?.pixels > allowed,
                None => false,
            };
            let status = if unstable {
                Status::Unstable
            } else if diff.identical || diff.pixels <= allowed {
                Status::Unchanged
            } else {
                Status::Changed
            };
            let composite = if status == Status::Unchanged {
                None
            } else {
                let (before, after) = (load(base)?, load(head)?);
                composite(
                    composites,
                    shot,
                    &[&before, &after, &highlight(&before, &after)],
                )?
            };
            let note = if diff.same_size {
                String::new()
            } else {
                "the two renders have different dimensions".to_owned()
            };
            Ok(Outcome {
                status,
                pixels: diff.pixels,
                total: diff.total,
                composite,
                note,
            })
        }
    }
}

/// Differing pixels at or below this are noise, for `--fuzz` a percentage of the shot.
fn allowed(total: u64, fuzz: f64) -> u64 {
    (total as f64 * fuzz / 100.0) as u64
}

fn percent(pixels: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        100.0 * pixels as f64 / total as f64
    }
}

fn pixels(image: &RgbaImage) -> u64 {
    u64::from(image.width()) * u64::from(image.height())
}

fn load(path: &Path) -> Result<RgbaImage> {
    image::open(path)
        .with_context(|| format!("reading {}", path.display()))
        .map(|image| image.into_rgba8())
}

fn dimensions(path: &Path) -> Result<(u32, u32)> {
    image::ImageReader::open(path)
        .with_context(|| format!("reading {}", path.display()))?
        .into_dimensions()
        .with_context(|| format!("reading the header of {}", path.display()))
}

/// Two renders of the same code: no pixels to read when the files match, which is most of them.
fn compare_files(a: &Path, b: &Path) -> Result<Diff> {
    if same_bytes(a, b)? {
        let (width, height) = dimensions(a)?;
        return Ok(Diff {
            pixels: 0,
            total: u64::from(width) * u64::from(height),
            identical: true,
            same_size: true,
        });
    }
    let (first, second) = (load(a)?, load(b)?);
    if first.dimensions() != second.dimensions() {
        let total = pixels(&second);
        return Ok(Diff {
            pixels: total,
            total,
            identical: false,
            same_size: false,
        });
    }
    let differing = first
        .pixels()
        .zip(second.pixels())
        .filter(|(one, other)| one != other)
        .count() as u64;
    Ok(Diff {
        pixels: differing,
        total: pixels(&first),
        identical: false,
        same_size: true,
    })
}

fn same_bytes(a: &Path, b: &Path) -> Result<bool> {
    if size(a)? != size(b)? {
        return Ok(false);
    }
    Ok(fs::read(a).with_context(|| a.display().to_string())?
        == fs::read(b).with_context(|| b.display().to_string())?)
}

fn size(path: &Path) -> Result<u64> {
    Ok(fs::metadata(path)
        .with_context(|| format!("reading {}", path.display()))?
        .len())
}

/// The after shot, dimmed, with every pixel that differs from the before shot marked.
fn highlight(before: &RgbaImage, after: &RgbaImage) -> RgbaImage {
    let mut out = RgbaImage::new(after.width(), after.height());
    for (x, y, pixel) in out.enumerate_pixels_mut() {
        let after = *after.get_pixel(x, y);
        let same = x < before.width() && y < before.height() && *before.get_pixel(x, y) == after;
        let [red, green, blue, _] = after.0;
        *pixel = if same {
            Rgba([red / 3, green / 3, blue / 3, 0xff])
        } else {
            MARK
        };
    }
    out
}

fn composite(dir: Option<&Path>, shot: &Shot, panels: &[&RgbaImage]) -> Result<Option<PathBuf>> {
    let Some(dir) = dir else {
        return Ok(None);
    };
    let width = panels.iter().map(|panel| panel.width()).sum::<u32>()
        + GAP * panels.len().saturating_sub(1) as u32;
    let height = panels.iter().map(|panel| panel.height()).max().unwrap_or(0);
    let mut out = RgbaImage::from_pixel(width, height, GAP_COLOUR);
    let mut x = 0;
    for panel in panels {
        image::imageops::replace(&mut out, *panel, i64::from(x), 0);
        x += panel.width() + GAP;
    }
    let path = dir.join(format!("{}-{}.png", shot.story, shot.size));
    out.save(&path)
        .with_context(|| format!("writing {}", path.display()))?;
    Ok(Some(path))
}

fn one_line(text: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    flat.chars().take(300).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_differing_pixel_is_counted_once() {
        let before = flat([0, 0, 0, 255], 4, 4);
        let mut after = before.clone();
        after.put_pixel(2, 1, Rgba([1, 0, 0, 255]));
        let diff = compare_files(&write(&before, "pixel-a"), &write(&after, "pixel-b")).unwrap();
        assert_eq!(diff.pixels, 1);
        assert_eq!(diff.total, 16);
        assert!(!diff.identical);
    }

    #[test]
    fn identical_bytes_need_no_pixels_read() {
        let image = flat([9, 9, 9, 255], 4, 4);
        let diff = compare_files(&write(&image, "same-a"), &write(&image, "same-b")).unwrap();
        assert_eq!((diff.pixels, diff.total, diff.identical), (0, 16, true));
    }

    #[test]
    fn fuzz_is_a_percentage_of_the_shot() {
        assert_eq!(allowed(1_000_000, 0.0), 0);
        assert_eq!(allowed(1_000_000, 0.01), 100);
        assert_eq!(allowed(1_000_000, 1.0), 10_000);
    }

    #[test]
    fn the_highlight_dims_the_after_shot_and_marks_what_differs() {
        let before = flat([0, 0, 0, 255], 2, 1);
        let mut after = before.clone();
        after.put_pixel(1, 0, Rgba([255, 255, 255, 255]));
        let marked = highlight(&before, &after);
        assert_eq!(*marked.get_pixel(0, 0), Rgba([0, 0, 0, 255]));
        assert_eq!(*marked.get_pixel(1, 0), MARK);
    }

    fn flat(colour: [u8; 4], width: u32, height: u32) -> RgbaImage {
        RgbaImage::from_pixel(width, height, Rgba(colour))
    }

    /// A PNG under the build's temp dir, one subdirectory per test name.
    fn write(image: &RgbaImage, name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rig-shot-compare-{name}"));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{name}.png"));
        image.save(&path).unwrap();
        path
    }
}
