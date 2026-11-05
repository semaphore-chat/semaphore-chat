#!/usr/bin/env python3
"""Disk footprint of a packaged client (stdlib only).

Sizes are apparent bytes (st_size), not `du`: /home is btrfs here, where
transparent compression makes du's number depend on the filesystem.

  disk.py analyze APP_DIR [--binary NAME] [--release-assets FILE] [--top N]
  disk.py evict APP_DIR     Drop APP_DIR's clean pages from the page cache
                            (no root needed), for cold-start runs.
"""
import argparse
import json
import os
import struct
import subprocess
import sys

MB = 1024 * 1024


def walk_sizes(root):
    """{relative path: bytes} of every regular file under root (symlinks skipped)."""
    sizes = {}
    for folder, _dirs, files in os.walk(root):
        for name in files:
            path = os.path.join(folder, name)
            if not os.path.islink(path):
                sizes[os.path.relpath(path, root)] = os.stat(path).st_size
    return sizes


def top_level_totals(sizes):
    """Total bytes per first path component."""
    totals = {}
    for rel, size in sizes.items():
        head = rel.split(os.sep, 1)[0]
        totals[head] = totals.get(head, 0) + size
    return totals


def read_asar_header(path):
    """The JSON index of an asar archive.

    Format: a Chromium Pickle of a uint32 (header pickle size), then a Pickle
    holding the JSON string: at byte 12 the string length, at byte 16 the JSON.
    """
    with open(path, 'rb') as fh:
        prefix = fh.read(16)
        if len(prefix) < 16:
            raise ValueError(f'{path}: too short to be an asar archive')
        length = struct.unpack('<I', prefix[12:16])[0]
        return json.loads(fh.read(length).decode('utf-8'))


def asar_files(node, prefix=''):
    """Yield (path, size, unpacked) for each file in an asar index node."""
    for name, entry in node.get('files', {}).items():
        path = f'{prefix}{name}'
        if 'files' in entry:
            yield from asar_files(entry, f'{path}/')
        elif 'size' in entry:
            yield path, int(entry['size']), bool(entry.get('unpacked'))


def contributor_group(path):
    """node_modules/<pkg> (or the deepest one, for nested deps), else the first two directories."""
    parts = path.split('/')
    if 'node_modules' in parts:
        at = len(parts) - 1 - parts[::-1].index('node_modules')
        name = parts[at + 1:at + 3] if parts[at + 1:at + 2] and parts[at + 1].startswith('@') else parts[at + 1:at + 2]
        return 'node_modules/' + '/'.join(name)
    return '/'.join(parts[:2]) if len(parts) > 2 else parts[0]


def analyze_asar(path, top=30):
    files = list(asar_files(read_asar_header(path)))
    groups = {}
    for name, size, _unpacked in files:
        key = contributor_group(name)
        groups[key] = groups.get(key, 0) + size
    extensions = {}
    for name, size, _unpacked in files:
        ext = os.path.splitext(name)[1].lower() or '(none)'
        extensions[ext] = extensions.get(ext, 0) + size
    total = sum(size for _n, size, _u in files)
    return {
        'bytes': os.stat(path).st_size,
        'indexed_bytes': total,
        'file_count': len(files),
        'top_groups': _ranked(groups, top),
        'top_files': [{'path': n, 'bytes': s} for n, s, _u in
                      sorted(files, key=lambda f: -f[1])[:top]],
        'by_extension': _ranked(extensions, 12),
    }


def _ranked(mapping, top):
    return [{'path': key, 'bytes': value} for key, value in
            sorted(mapping.items(), key=lambda kv: -kv[1])[:top]]


def binary_info(path):
    """Size and whether `file` says the ELF is stripped (None if `file` is unavailable)."""
    info = {'path': os.path.basename(path), 'bytes': os.stat(path).st_size, 'stripped': None}
    try:
        text = subprocess.run(['file', '-b', path], capture_output=True, text=True,
                              check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return info
    if 'not stripped' in text:
        info['stripped'] = False
    elif 'stripped' in text:
        info['stripped'] = True
    return info


def analyze(app_dir, binary='semaphore-chat', release_assets=None, top=30):
    """The `disk` object of the results file."""
    sizes = walk_sizes(app_dir)
    result = {
        'unpacked_bytes': sum(sizes.values()),
        'file_count': len(sizes),
        'top_level': _ranked(top_level_totals(sizes), top),
        'largest_files': _ranked(sizes, top),
        'binary': binary_info(os.path.join(app_dir, binary)),
        'artifacts': [],
    }
    asar = os.path.join(app_dir, 'resources', 'app.asar')
    if os.path.exists(asar):
        result['app_asar'] = analyze_asar(asar, top)
    if release_assets:
        with open(release_assets, encoding='utf-8') as fh:
            data = json.load(fh)
        result['artifacts'] = [
            {'name': a['name'], 'bytes': a['size'], 'source': data.get('source', 'release')}
            for a in data['assets']
            if not a['name'].endswith(('.yml', '.blockmap'))
        ]
    return result


def evict(root):
    """posix_fadvise(DONTNEED) every file. Mapped or dirty pages stay; returns bytes requested."""
    total = 0
    for rel, size in walk_sizes(root).items():
        fd = os.open(os.path.join(root, rel), os.O_RDONLY)
        try:
            os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
            total += size
        finally:
            os.close(fd)
    return total


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='cmd', required=True)
    an = sub.add_parser('analyze')
    an.add_argument('app_dir')
    an.add_argument('--binary', default='semaphore-chat')
    an.add_argument('--release-assets')
    an.add_argument('--top', type=int, default=30)
    ev = sub.add_parser('evict')
    ev.add_argument('app_dir')
    args = parser.parse_args()
    if args.cmd == 'analyze':
        json.dump(analyze(args.app_dir, args.binary, args.release_assets, args.top), sys.stdout, indent=1)
        print()
    else:
        print(evict(args.app_dir))


if __name__ == '__main__':
    main()
