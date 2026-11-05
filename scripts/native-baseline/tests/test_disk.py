"""Unit tests for disk.py. Run: python3 -m unittest discover -s tests"""
import json
import os
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import disk  # noqa: E402


def write_asar(path, index, body=b''):
    """Writes the real on-disk layout: size pickle, then the JSON string pickle."""
    data = json.dumps(index).encode()
    padded = len(data) + (-len(data) % 4)
    header_pickle = struct.pack('<II', padded + 4, len(data)) + data + b'\0' * (padded - len(data))
    size_pickle = struct.pack('<II', 4, len(header_pickle))
    with open(path, 'wb') as fh:
        fh.write(size_pickle + header_pickle + body)


INDEX = {'files': {
    'dist': {'files': {
        'index.html': {'size': 100, 'offset': '0'},
        'assets': {'files': {'index-abc.js': {'size': 5000, 'offset': '100'}}},
    }},
    'node_modules': {'files': {
        'electron-updater': {'files': {'out': {'files': {'main.js': {'size': 300, 'offset': '5100'}}}}},
        '@scope': {'files': {'pkg': {'files': {'a.node': {'size': 800, 'unpacked': True}}}}},
        'outer': {'files': {
            'x.js': {'size': 10, 'offset': '5400'},
            'node_modules': {'files': {'inner': {'files': {'y.js': {'size': 20, 'offset': '5410'}}}}},
        }},
    }},
    'link': {'link': 'dist/index.html'},
}}


class AsarTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = os.path.join(self.dir.name, 'app.asar')
        write_asar(self.path, INDEX, b'x' * 100)

    def test_reads_the_index(self):
        self.assertEqual(disk.read_asar_header(self.path), INDEX)

    def test_lists_files_and_skips_symlinks(self):
        names = {name for name, _s, _u in disk.asar_files(INDEX)}
        self.assertIn('dist/assets/index-abc.js', names)
        self.assertNotIn('link', names)

    def test_groups_by_package_including_scopes_and_nested_deps(self):
        self.assertEqual(disk.contributor_group('node_modules/electron-updater/out/main.js'),
                         'node_modules/electron-updater')
        self.assertEqual(disk.contributor_group('node_modules/@scope/pkg/a.node'),
                         'node_modules/@scope/pkg')
        self.assertEqual(disk.contributor_group('node_modules/outer/node_modules/inner/y.js'),
                         'node_modules/inner')
        self.assertEqual(disk.contributor_group('dist/assets/index-abc.js'), 'dist/assets')
        self.assertEqual(disk.contributor_group('package.json'), 'package.json')

    def test_analysis_ranks_contributors(self):
        result = disk.analyze_asar(self.path)
        self.assertEqual(result['file_count'], 6)
        self.assertEqual(result['indexed_bytes'], 100 + 5000 + 300 + 800 + 10 + 20)
        self.assertEqual(result['top_groups'][0], {'path': 'dist/assets', 'bytes': 5000})
        self.assertEqual(result['top_files'][0]['path'], 'dist/assets/index-abc.js')
        self.assertEqual(result['by_extension'][0], {'path': '.js', 'bytes': 5330})

    def test_truncated_file_is_an_error(self):
        short = os.path.join(self.dir.name, 'short.asar')
        with open(short, 'wb') as fh:
            fh.write(b'abc')
        with self.assertRaises(ValueError):
            disk.read_asar_header(short)


class AnalyzeTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        root = self.dir.name
        os.makedirs(f'{root}/resources')
        with open(f'{root}/semaphore-chat', 'wb') as fh:
            fh.write(b'\0' * 1000)
        with open(f'{root}/resources/extra.bin', 'wb') as fh:
            fh.write(b'\0' * 500)
        os.symlink(f'{root}/semaphore-chat', f'{root}/link')
        write_asar(f'{root}/resources/app.asar', {'files': {'a.js': {'size': 3, 'offset': '0'}}}, b'abc')

    def test_apparent_sizes_skip_symlinks(self):
        sizes = disk.walk_sizes(self.dir.name)
        self.assertNotIn('link', sizes)
        self.assertEqual(sizes['semaphore-chat'], 1000)

    def test_full_report(self):
        assets = os.path.join(self.dir.name, 'assets.json')
        with open(assets, 'w', encoding='utf-8') as fh:
            json.dump({'source': 'v0.7.0', 'assets': [
                {'name': 'Semaphore-Chat-0.7.0.AppImage', 'size': 159},
                {'name': 'latest-linux.yml', 'size': 1},
                {'name': 'x.exe.blockmap', 'size': 1},
            ]}, fh)
        result = disk.analyze(self.dir.name, release_assets=assets)
        self.assertEqual(result['binary']['bytes'], 1000)
        self.assertEqual(result['top_level'][0], {'path': 'semaphore-chat', 'bytes': 1000})
        self.assertEqual(result['app_asar']['file_count'], 1)
        self.assertEqual(result['artifacts'], [
            {'name': 'Semaphore-Chat-0.7.0.AppImage', 'bytes': 159, 'source': 'v0.7.0'}])

    def test_client_without_an_asar_still_reports(self):
        os.remove(f'{self.dir.name}/resources/app.asar')
        self.assertNotIn('app_asar', disk.analyze(self.dir.name))

    def test_evict_visits_every_file(self):
        self.assertEqual(disk.evict(self.dir.name), sum(disk.walk_sizes(self.dir.name).values()))


if __name__ == '__main__':
    unittest.main()
