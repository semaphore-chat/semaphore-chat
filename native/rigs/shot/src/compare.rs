//! Comparing the same story as rendered on two sides, for the native UI review.
//!
//! `rig-shot --compare <jobs> --composites <dir> [--fuzz <percent>] [--threads <n>]` reads a tab-separated jobs
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
//!
//! The jobs are spread over `--threads` workers (default: the machine's cores) and the results are
//! printed in jobs-file order, so the output doesn't depend on the thread count. Each PNG is
//! decoded at most once per job. A run with nearly every shot changed is bound by PNG decoding and
//! encoding: ui-review.sh runs a debug build, so the workspace builds the image codecs optimised
//! even in dev (`native/Cargo.toml`, rig-shot itself too), or 2000 changed shots took over an
//! hour (#885).

use anyhow::{Context as _, Result, bail};
use image::{Rgba, RgbaImage};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::thread;

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

pub fn run(
    jobs: &Path,
    composites: Option<&Path>,
    fuzz: f64,
    threads: Option<usize>,
) -> Result<()> {
    if !(0.0..=100.0).contains(&fuzz) {
        bail!("--fuzz takes a percentage of pixels, from 0 to 100");
    }
    let source = fs::read_to_string(jobs).with_context(|| format!("reading {}", jobs.display()))?;
    let shots = parse(&source, jobs)?;
    if let Some(dir) = composites {
        fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    }
    let threads = threads
        .unwrap_or_else(|| thread::available_parallelism().map_or(1, |n| n.get()))
        .max(1);
    let mut stdout = std::io::stdout().lock();
    let mut failed = 0usize;
    compare_all(&shots, composites, fuzz, threads, |line, status| {
        if status == Status::Failed {
            failed += 1;
        }
        writeln!(stdout, "{line}").context("writing the results")
    })?;
    stdout.flush().context("writing the results")?;
    if failed > 0 {
        bail!("{failed} shot(s) could not be compared");
    }
    Ok(())
}

fn parse(source: &str, jobs: &Path) -> Result<Vec<Shot>> {
    let mut shots = Vec::new();
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
        shots.push(Shot {
            story: fields[0].to_owned(),
            size: fields[1].to_owned(),
            base: Side::parse(fields[2]),
            head: Side::parse(fields[3]),
            head2: Side::parse(fields[4]),
        });
    }
    Ok(shots)
}

/// Judges every shot on `threads` workers and hands each result line to `emit` in `shots` order,
/// as soon as it and every line before it are done.
fn compare_all(
    shots: &[Shot],
    composites: Option<&Path>,
    fuzz: f64,
    threads: usize,
    mut emit: impl FnMut(&str, Status) -> Result<()>,
) -> Result<()> {
    let next = AtomicUsize::new(0);
    let (sender, receiver) = mpsc::channel::<(usize, String, Status)>();
    thread::scope(|scope| {
        for _ in 0..threads.min(shots.len()) {
            let (next, sender) = (&next, sender.clone());
            scope.spawn(move || {
                loop {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    let Some(shot) = shots.get(index) else { break };
                    let (line, status) = result_line(shot, composites, fuzz);
                    if sender.send((index, line, status)).is_err() {
                        break;
                    }
                }
            });
        }
        drop(sender);
        let mut pending = BTreeMap::new();
        let mut printed = 0usize;
        for (index, line, status) in receiver {
            pending.insert(index, (line, status));
            while let Some((line, status)) = pending.remove(&printed) {
                emit(&line, status)?;
                printed += 1;
            }
        }
        Ok(())
    })
}

fn result_line(shot: &Shot, composites: Option<&Path>, fuzz: f64) -> (String, Status) {
    let outcome = judge(shot, composites, fuzz).unwrap_or_else(|error| Outcome {
        status: Status::Failed,
        pixels: 0,
        total: 0,
        composite: None,
        note: one_line(&format!("{error:#}")),
    });
    let line = format!(
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
    (line, outcome.status)
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
            let (mut base, mut head) = (Render::new(base), Render::new(head));
            let diff = compare_renders(&mut base, &mut head)?;
            let allowed = allowed(diff.total, fuzz);
            let unstable = match shot.head2.path() {
                Some(second) => {
                    compare_renders(&mut head, &mut Render::new(second))?.pixels > allowed
                }
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
                let (before, after) = (base.image()?, head.image()?);
                composite(
                    composites,
                    shot,
                    &[before, after, &highlight(before, after)],
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

/// A PNG on disk, decoded the first time its pixels are needed and then kept.
struct Render<'a> {
    path: &'a Path,
    image: Option<RgbaImage>,
}

impl<'a> Render<'a> {
    fn new(path: &'a Path) -> Self {
        Render { path, image: None }
    }

    fn image(&mut self) -> Result<&RgbaImage> {
        if self.image.is_none() {
            self.image = Some(load(self.path)?);
        }
        Ok(self.image.as_ref().expect("decoded above"))
    }
}

/// Two renders of the same code: no pixels to read when the files match, which is most of them.
#[cfg(test)]
fn compare_files(a: &Path, b: &Path) -> Result<Diff> {
    compare_renders(&mut Render::new(a), &mut Render::new(b))
}

fn compare_renders(a: &mut Render, b: &mut Render) -> Result<Diff> {
    if same_bytes(a.path, b.path)? {
        let (width, height) = dimensions(a.path)?;
        return Ok(Diff {
            pixels: 0,
            total: u64::from(width) * u64::from(height),
            identical: true,
            same_size: true,
        });
    }
    a.image()?;
    let (first, second) = (a.image.as_ref().expect("decoded above"), b.image()?);
    if first.dimensions() != second.dimensions() {
        let total = pixels(second);
        return Ok(Diff {
            pixels: total,
            total,
            identical: false,
            same_size: false,
        });
    }
    Ok(Diff {
        pixels: differing(first, second),
        total: pixels(first),
        identical: false,
        same_size: true,
    })
}

/// Pixels that differ between two images of the same size. Rows are compared whole first (a
/// `memcmp`), so only the rows that changed are walked pixel by pixel.
fn differing(first: &RgbaImage, second: &RgbaImage) -> u64 {
    let row = first.width() as usize * 4;
    if row == 0 {
        return 0;
    }
    first
        .as_raw()
        .chunks_exact(row)
        .zip(second.as_raw().chunks_exact(row))
        .filter(|(one, other)| one != other)
        .map(|(one, other)| {
            one.as_chunks::<4>()
                .0
                .iter()
                .zip(other.as_chunks::<4>().0)
                .filter(|(a, b)| a != b)
                .count() as u64
        })
        .sum()
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
    let (width, height) = (after.width() as usize, after.height() as usize);
    if width == 0 || height == 0 {
        return RgbaImage::new(after.width(), after.height());
    }
    let before_width = before.width() as usize;
    let mut out = Vec::with_capacity(width * height * 4);
    for (y, row) in after.as_raw().chunks_exact(width * 4).enumerate() {
        let before_row = (y < before.height() as usize).then(|| {
            let start = y * before_width * 4;
            &before.as_raw()[start..start + before_width.min(width) * 4]
        });
        for (x, pixel) in row.as_chunks::<4>().0.iter().enumerate() {
            let same =
                before_row.is_some_and(|before| before.get(x * 4..x * 4 + 4) == Some(&pixel[..]));
            if same {
                out.extend_from_slice(&[pixel[0] / 3, pixel[1] / 3, pixel[2] / 3, 0xff]);
            } else {
                out.extend_from_slice(&MARK.0);
            }
        }
    }
    RgbaImage::from_raw(after.width(), after.height(), out).expect("one pixel per pixel")
}

/// The panels side by side, top-aligned, `GAP` apart, written as a PNG named after the shot.
fn composite(dir: Option<&Path>, shot: &Shot, panels: &[&RgbaImage]) -> Result<Option<PathBuf>> {
    let Some(dir) = dir else {
        return Ok(None);
    };
    let out = side_by_side(panels);
    let path = dir.join(format!("{}-{}.png", shot.story, shot.size));
    out.save(&path)
        .with_context(|| format!("writing {}", path.display()))?;
    Ok(Some(path))
}

fn side_by_side(panels: &[&RgbaImage]) -> RgbaImage {
    let width = panels.iter().map(|panel| panel.width()).sum::<u32>()
        + GAP * panels.len().saturating_sub(1) as u32;
    let height = panels.iter().map(|panel| panel.height()).max().unwrap_or(0);
    let mut out = RgbaImage::from_pixel(width, height, GAP_COLOUR);
    let stride = width as usize * 4;
    let raw: &mut [u8] = &mut out;
    let mut x = 0usize;
    for panel in panels {
        let row = panel.width() as usize * 4;
        if row > 0 {
            for (y, source) in panel.as_raw().chunks_exact(row).enumerate() {
                let start = y * stride + x * 4;
                raw[start..start + row].copy_from_slice(source);
            }
        }
        x += panel.width() as usize + GAP as usize;
    }
    out
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

    #[test]
    fn the_highlight_marks_pixels_outside_a_smaller_before_shot() {
        let before = flat([5, 5, 5, 255], 1, 1);
        let after = flat([5, 5, 5, 255], 2, 2);
        let marked = highlight(&before, &after);
        assert_eq!(*marked.get_pixel(0, 0), Rgba([1, 1, 1, 255]));
        assert_eq!(*marked.get_pixel(1, 0), MARK);
        assert_eq!(*marked.get_pixel(0, 1), MARK);
        assert_eq!(*marked.get_pixel(1, 1), MARK);
    }

    #[test]
    fn differing_counts_pixels_not_rows_or_bytes() {
        let before = flat([0, 0, 0, 255], 5, 3);
        let mut after = before.clone();
        after.put_pixel(0, 0, Rgba([0, 0, 0, 254]));
        after.put_pixel(4, 0, Rgba([1, 1, 1, 255]));
        after.put_pixel(2, 2, Rgba([0, 9, 0, 255]));
        assert_eq!(differing(&before, &after), 3);
        assert_eq!(differing(&before, &before), 0);
    }

    /// The composite is the same picture `imageops::replace` made before it was rewritten.
    #[test]
    fn side_by_side_matches_placing_each_panel() {
        let panels = [gradient(3, 2, 0), gradient(2, 4, 50), gradient(4, 1, 100)];
        let refs: Vec<&RgbaImage> = panels.iter().collect();
        let width = 3 + 2 + 4 + 2 * GAP;
        let mut expected = RgbaImage::from_pixel(width, 4, GAP_COLOUR);
        let mut x = 0;
        for panel in &panels {
            image::imageops::replace(&mut expected, panel, i64::from(x), 0);
            x += panel.width() + GAP;
        }
        assert_eq!(side_by_side(&refs), expected);
    }

    /// The result lines come out in jobs order and say the same thing however many threads run.
    #[test]
    fn a_parallel_run_prints_what_a_serial_run_prints() {
        let dir = std::env::temp_dir().join("rig-shot-compare-parallel");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let png = |name: &str, image: &RgbaImage| {
            let path = dir.join(format!("{name}.png"));
            image.save(&path).unwrap();
            path.display().to_string()
        };
        let mut lines = Vec::new();
        for index in 0..24u8 {
            let base = gradient(6, 5, index);
            let mut changed = base.clone();
            changed.put_pixel(u32::from(index % 6), 1, Rgba([255, 0, 0, 255]));
            let mut wobble = changed.clone();
            wobble.put_pixel(0, 4, Rgba([0, 255, 0, 255]));
            let (b, c, w) = (
                png(&format!("base-{index}"), &base),
                png(&format!("changed-{index}"), &changed),
                png(&format!("wobble-{index}"), &wobble),
            );
            let missing = dir.join("missing.png").display().to_string();
            let (head, head2, base) = match index % 6 {
                0 => (b.clone(), b.clone(), b),             // unchanged
                1 => (c.clone(), c.clone(), b),             // changed
                2 => (c, w, b),                             // unstable
                3 => (c, "absent".into(), "absent".into()), // new
                4 => ("absent".into(), "absent".into(), b), // removed
                _ => (missing, "absent".into(), b),         // failed
            };
            lines.push(format!("story-{index}\tdesktop\t{base}\t{head}\t{head2}"));
        }
        let shots = parse(&lines.join("\n"), Path::new("jobs.tsv")).unwrap();
        let run = |threads: usize, composites: &Path| {
            let mut out = Vec::new();
            compare_all(&shots, Some(composites), 0.0, threads, |line, _| {
                out.push(line.replace(&composites.display().to_string(), "<dir>"));
                Ok(())
            })
            .unwrap();
            out
        };
        let (serial_dir, parallel_dir) = (dir.join("serial"), dir.join("parallel"));
        fs::create_dir_all(&serial_dir).unwrap();
        fs::create_dir_all(&parallel_dir).unwrap();
        let serial = run(1, &serial_dir);
        let parallel = run(8, &parallel_dir);
        assert_eq!(serial, parallel);
        let statuses: Vec<&str> = serial
            .iter()
            .map(|line| line.split('\t').nth(2).unwrap())
            .collect();
        assert_eq!(
            &statuses[..6],
            [
                "unchanged",
                "changed",
                "unstable",
                "new",
                "removed",
                "failed"
            ]
        );
        for (index, line) in serial.iter().enumerate() {
            assert!(line.starts_with(&format!("story-{index}\t")), "{line}");
        }
        for name in fs::read_dir(&serial_dir).unwrap() {
            let name = name.unwrap().file_name();
            let one = image::open(serial_dir.join(&name)).unwrap().into_rgba8();
            let other = image::open(parallel_dir.join(&name)).unwrap().into_rgba8();
            assert_eq!(one, other, "{name:?}");
        }
    }

    fn gradient(width: u32, height: u32, seed: u8) -> RgbaImage {
        RgbaImage::from_fn(width, height, |x, y| {
            Rgba([seed.wrapping_add(x as u8 * 17), y as u8 * 29, seed, 255])
        })
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
