#!/usr/bin/env python3
"""The native UI review's bookkeeping: the comparison jobs, the report and the PR section.

`rig-shot --compare` decides one story at one size; this turns a whole run into
`out/report.json` and `out/pr-block.md`, and can put the section into a PR description. It runs on
the host (Python 3, standard library only) so nothing has to be built to change the wording.

    ui-review-report.py jobs   --base-stories FILE --head-stories FILE --sizes SPEC \
                               --base-dir DIR --head-dir DIR --head2-dir DIR --out FILE
    ui-review-report.py report --compare FILE --json FILE --markdown FILE --repo-root DIR \
                               --base-ref REF --base-sha SHA --head-ref REF --head-sha SHA \
                               --dirty 0|1 --sizes SPEC --fuzz N --command CMD
    ui-review-report.py splice --body FILE --block FILE --out FILE
"""

import argparse
import datetime
import json
import os
import re
import sys

START = "<!-- native-ui-review:start -->"
END = "<!-- native-ui-review:end -->"

# The desktop review (ui-review.sh) and the Android one (android-ui-review.sh) share this script;
# each has its own PR section, so a PR touching both keeps both. `--flavour` picks one.
FLAVOURS = {
    "native": {
        "tool": "native-ui-review",
        "title": "Native UI review",
        "composites": "native/.ui-review/out/composites/",
        "artifact": "native-ui-review",
    },
    "android": {
        "tool": "android-ui-review",
        "title": "Android UI review",
        "composites": "native/android/.ui-review/out/composites/",
        # No CI job renders the Android stories for a review yet: the composites stay local.
        "artifact": None,
    },
}
FLAVOUR = FLAVOURS["native"]


def use_flavour(name):
    """Set the markers and wording for one review."""
    global START, END, FLAVOUR
    FLAVOUR = FLAVOURS[name]
    START = f"<!-- {FLAVOUR['tool']}:start -->"
    END = f"<!-- {FLAVOUR['tool']}:end -->"

STATUSES = ("changed", "new", "removed", "unstable", "unchanged", "failed")


def read_lines(path):
    if not path or not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as handle:
        return [line.rstrip("\n") for line in handle if line.strip()]


def read_ids(path):
    return [line.strip() for line in read_lines(path) if line.strip()]


def write(path, text):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def size_names(spec):
    return [entry.split(":")[0] for entry in spec.split(",") if entry.strip()]


def size_label(spec):
    parts = []
    for entry in spec.split(","):
        name, width, height = entry.split(":")
        parts.append(f"{name} {width}x{height}")
    return " / ".join(parts)


# ---------------------------------------------------------------- jobs


def cmd_jobs(args):
    base = set(read_ids(args.base_stories))
    head = set(read_ids(args.head_stories))
    lines = []
    for size in size_names(args.sizes):
        for story in sorted(base | head):
            sides = []
            for known, directory in (
                (base, args.base_dir),
                (head, args.head_dir),
                (head, args.head2_dir),
            ):
                sides.append(
                    os.path.join(directory, size, f"{story}.png") if story in known else "absent"
                )
            lines.append("\t".join([story, size] + sides))
    write(args.out, "\n".join(lines) + ("\n" if lines else ""))
    print(f"{len(lines)} job(s), {len(base | head)} stories at {len(size_names(args.sizes))} size(s)")


# ---------------------------------------------------------------- report


def read_compare(path):
    shots = []
    for line in read_lines(path):
        fields = line.split("\t")
        if len(fields) != 8:
            raise SystemExit(f"{path}: expected 8 tab-separated fields, found {len(fields)}")
        story, size, status, pixels, total, percent, composite, note = fields
        if status not in STATUSES:
            raise SystemExit(f"{path}: unknown status {status!r}")
        shots.append(
            {
                "story": story,
                "size": size,
                "status": status,
                "diffPixels": int(pixels),
                "totalPixels": int(total),
                "diffPercent": float(percent),
                "composite": None if composite == "-" else composite,
                "note": note,
            }
        )
    return shots


def story_status(shots):
    statuses = [shot["status"] for shot in shots]
    if "failed" in statuses:
        return "failed"
    if all(status == "new" for status in statuses):
        return "new"
    if all(status == "removed" for status in statuses):
        return "removed"
    if any(status in ("changed", "new", "removed") for status in statuses):
        return "changed"
    if "unstable" in statuses:
        return "unstable"
    return "unchanged"


def group(shots):
    stories = {}
    for shot in shots:
        stories.setdefault(shot["story"], []).append(shot)
    return [
        {"id": story, "status": story_status(rows), "shots": rows}
        for story, rows in sorted(stories.items())
    ]


def number(count):
    return f"{count:,}"


def percent(value):
    return "<0.01%" if 0 < value < 0.01 else f"{value:.2f}%"


def code(text):
    return f"`{text.replace('`', "'")}`"


def render_block(report, repo_root):
    summary = report["summary"]
    out = [START, f"## {FLAVOUR['title']}", ""]
    counts = [
        f"**{summary['changed']} changed**",
        f"{summary['new']} new",
        f"{summary['removed']} removed",
        f"{summary['unstable']} unstable",
        f"{summary['unchanged']} unchanged",
    ]
    if summary["failed"]:
        counts.append(f"**{summary['failed']} failed**")
    dirty = " plus uncommitted changes" if report["head"]["dirty"] else ""
    out.extend(
        [
            f"{' · '.join(counts)} — base {code(report['base']['sha'][:7])} ({code(report['base']['ref'])})"
            f" → head {code(report['head']['sha'][:7])}{dirty} · {report['sizes']} · {report['mode']}",
            "",
        ]
    )

    notable = [story for story in report["stories"] if story["status"] != "unchanged"]
    if notable:
        out.append("| Story | Size | Status | Pixels changed | Composite |")
        out.append("| --- | --- | --- | ---: | --- |")
        for story in notable:
            for shot in story["shots"]:
                if shot["status"] == "unchanged":
                    continue
                changed = (
                    f"{number(shot['diffPixels'])} ({percent(shot['diffPercent'])})"
                    if shot["status"] in ("changed", "unstable")
                    else "—"
                )
                composite = (
                    code(os.path.relpath(shot["composite"], repo_root))
                    if shot["composite"]
                    else "—"
                )
                out.append(
                    f"| {code(story['id'])} | {shot['size']} | {shot['status']} | {changed} | {composite} |"
                )
        out.append("")
        out.extend(
            [
                "> Composites are **before | after | diff** (the diff is the after shot dimmed, differing"
                " pixels in red); new stories have only the after shot, removed ones only the before shot."
                f" They are local files under `{FLAVOUR['composites']}`"
                + (
                    f", and CI uploads that directory as the `{FLAVOUR['artifact']}` artifact."
                    if FLAVOUR["artifact"]
                    else "."
                ),
                "",
            ]
        )

    if summary["unstable"]:
        out.extend(
            [
                f"### Unstable ({summary['unstable']})",
                "",
                "These differ between base and head, but rendering the working tree a second time did"
                " not reproduce the difference (a story or the app renders non-deterministically), so"
                " it may not come from this change. Check them by eye.",
                "",
            ]
        )
        for story in report["stories"]:
            if story["status"] == "unstable":
                sizes = ", ".join(shot["size"] for shot in story["shots"] if shot["status"] == "unstable")
                out.append(f"- {code(story['id'])} — {sizes}")
        out.append("")

    if summary["failed"]:
        out.extend([f"### Failed to render ({summary['failed']})", ""])
        for story in report["stories"]:
            if story["status"] == "failed":
                errors = "; ".join(
                    f"{shot['size']}: {shot['note']}" for shot in story["shots"] if shot["status"] == "failed"
                )
                out.append(f"- {code(story['id'])} — {errors or 'no shot came out'}")
        out.extend(["", "These are failures of the run, not visual changes: it exits non-zero.", ""])

    unchanged = [story["id"] for story in report["stories"] if story["status"] == "unchanged"]
    if unchanged:
        out.extend(
            [
                f"<details><summary>Unchanged ({len(unchanged)}) — rendered on both sides, identical within tolerance</summary>",
                "",
                *[f"- {code(story)}" for story in unchanged],
                "",
                "</details>",
                "",
            ]
        )

    out.extend(
        [
            f"<sub>{report['shots']} shots over {report['stories_count']} stories; {report['mode']}. "
            f"Regenerate: {code(report['command'])}</sub>",
            END,
        ]
    )
    return "\n".join(out) + "\n"


def read_jobs(path):
    """Where each shot was rendered: (base, head, head2), `absent` where there is no story."""
    jobs = {}
    if not path or not os.path.exists(path):
        return jobs
    for line in read_lines(path):
        story, size, base, head, head2 = line.split("\t")
        jobs[(story, size)] = (base, head, head2)
    return jobs


def cmd_report(args):
    shots = read_compare(args.compare)
    jobs = read_jobs(args.jobs)
    stories = group(shots)
    summary = {status: 0 for status in STATUSES}
    for story in stories:
        summary[story["status"]] += 1

    def rendered(path):
        return path if path == "absent" else os.path.relpath(path, args.repo_root)

    def shot_with_paths(shot):
        base, head, head2 = jobs.get((shot["story"], shot["size"]), ("absent",) * 3)
        return {
            **shot,
            "base": rendered(base),
            "head": rendered(head),
            "head2": rendered(head2),
            "composite": None
            if shot["composite"] is None
            else os.path.relpath(shot["composite"], args.repo_root),
        }

    if args.fuzz > 0:
        mode = f"fuzz {args.fuzz:g}% of each shot's pixels"
    else:
        mode = "exact pixels"
    report = {
        "tool": FLAVOUR["tool"],
        "generated": datetime.datetime.now(datetime.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "base": {"ref": args.base_ref, "sha": args.base_sha},
        "head": {"ref": args.head_ref, "sha": args.head_sha, "dirty": args.dirty == "1"},
        "sizes": size_label(args.sizes),
        "mode": mode,
        "fuzzPercent": args.fuzz,
        "shots": len(shots),
        "stories_count": len(stories),
        "command": args.command,
        "summary": summary,
        "stories": [
            {
                "id": story["id"],
                "status": story["status"],
                "shots": [shot_with_paths(shot) for shot in story["shots"]],
            }
            for story in stories
        ],
    }
    write(args.json, json.dumps(report, indent=2) + "\n")
    write(args.markdown, render_block(report, args.repo_root))
    print(
        f"[{FLAVOUR['tool']}] diff: {summary['changed']} changed, {summary['new']} new,"
        f" {summary['removed']} removed, {summary['unstable']} unstable,"
        f" {summary['unchanged']} unchanged, {summary['failed']} failed"
    )
    return 0


# ---------------------------------------------------------------- splice

FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")


def find_block(body):
    """Offsets of the marked section: a marker counts on its own line, outside code fences."""
    fence = None
    start = end = None
    offset = 0
    for raw in body.split("\n"):
        line = raw[:-1] if raw.endswith("\r") else raw
        stripped = line.strip()
        match = FENCE.match(line)
        if fence:
            if (
                match
                and match.group(1)[0] == fence[0]
                and len(match.group(1)) >= len(fence)
                and stripped == match.group(1)
            ):
                fence = None
        elif match:
            fence = match.group(1)
        else:
            indent = len(line) - len(line.lstrip())
            if indent <= 3 and stripped in (START, END):
                if stripped == START and start is None:
                    start = offset + indent
                elif stripped == END and start is not None:
                    end = offset + indent + len(END)
                    break
        offset += len(raw) + 1
    if start is None:
        return None
    if end is None:
        raise SystemExit(
            f'the PR description has a "{START}" line without a "{END}" line after it —'
            " fix the description by hand, then run again"
        )
    return start, end


def splice(body, block):
    clean = block.rstrip()
    if not clean.startswith(START) or not clean.endswith(END):
        raise SystemExit(f"the section must start with {START} and end with {END}")
    found = find_block(body)
    if found:
        return body[: found[0]] + clean + body[found[1] :]
    if not body.strip():
        return clean + "\n"
    separator = "" if body.endswith("\n\n") else ("\n" if body.endswith("\n") else "\n\n")
    return body + separator + clean + "\n"


def cmd_splice(args):
    body = ""
    if args.body and os.path.exists(args.body):
        with open(args.body, encoding="utf-8") as handle:
            body = handle.read()
    with open(args.block, encoding="utf-8") as handle:
        block = handle.read()
    write(args.out, splice(body, block))
    print(f"PR description: {len(splice(body, block))} characters")


# ----------------------------------------------------------------


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    steps = parser.add_subparsers(dest="step", required=True)

    jobs = steps.add_parser("jobs", help="write the comparison jobs for a run")
    jobs.add_argument("--base-stories", default="")
    jobs.add_argument("--head-stories", required=True)
    jobs.add_argument("--sizes", required=True, help="desktop:1280:720,phone:390:844")
    jobs.add_argument("--base-dir", required=True)
    jobs.add_argument("--head-dir", required=True)
    jobs.add_argument("--head2-dir", required=True)
    jobs.add_argument("--out", required=True)
    jobs.set_defaults(run=cmd_jobs)

    report = steps.add_parser("report", help="write report.json and the PR section")
    report.add_argument("--compare", required=True)
    report.add_argument("--jobs", required=True)
    report.add_argument("--json", required=True)
    report.add_argument("--markdown", required=True)
    report.add_argument("--repo-root", required=True)
    report.add_argument("--base-ref", required=True)
    report.add_argument("--base-sha", required=True)
    report.add_argument("--head-ref", required=True)
    report.add_argument("--head-sha", required=True)
    report.add_argument("--dirty", default="0")
    report.add_argument("--sizes", required=True)
    report.add_argument("--fuzz", type=float, default=0.0)
    report.add_argument("--command", required=True)
    report.set_defaults(run=cmd_report)

    splice_parser = steps.add_parser("splice", help="replace the section in a PR description")
    splice_parser.add_argument("--body", default="")
    splice_parser.add_argument("--block", required=True)
    splice_parser.add_argument("--out", required=True)
    splice_parser.set_defaults(run=cmd_splice)

    for step in (report, splice_parser):
        step.add_argument("--flavour", choices=sorted(FLAVOURS), default="native")

    args = parser.parse_args(argv)
    use_flavour(getattr(args, "flavour", "native"))
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
