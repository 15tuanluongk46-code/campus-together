"""Behavior checks: preserving bytes, refusing secrets/special files, safe archives."""
import importlib.util
import io
import os
import socket
import tarfile
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("handoff", Path(__file__).with_name("handoff.py"))
assert SPEC is not None
h = importlib.util.module_from_spec(SPEC)
if SPEC.loader:
    SPEC.loader.exec_module(h)


class HandoffTests(unittest.TestCase):
    def setUp(self):
        base = Path(__file__).resolve().parents[1] / ".handoff"
        base.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=base)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_capture_ignored_files_links_and_special_metadata(self):
        (self.root / "node_modules").mkdir()
        (self.root / "node_modules/x").write_bytes(b"historical dependency")
        (self.root / ".env").write_bytes(b"must not be opened")
        (self.root / ".git").mkdir()
        (self.root / ".git/config").write_bytes(b"excluded")
        (self.root / "external").symlink_to("/nonexistent/outside")
        os.mkfifo(self.root / "pipe")
        sock = socket.socket(socket.AF_UNIX)
        self.addCleanup(sock.close)
        sock.bind(str(self.root / "sock"))
        out = self.root / ".handoff/run"
        manifest = h.capture(self.root, out)
        rows = {r["path"]: r for r in manifest["entries"]}
        self.assertEqual((out / "tree/node_modules/x").read_bytes(), b"historical dependency")
        self.assertFalse((out / "tree/.env").exists())
        self.assertIsNone(rows[".env"]["sha256"])
        self.assertEqual(rows["pipe"]["disposition"], "metadata-only")
        self.assertEqual(rows["sock"]["disposition"], "metadata-only")
        self.assertEqual(os.readlink(out / "tree/external"), "/nonexistent/outside")
        self.assertEqual(rows[".git/config"]["reason"], "git-history-controller-owned")

    def test_nested_archive_credentials_are_not_read(self):
        archive = self.root / "nested.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            info = tarfile.TarInfo("hidden/.env")
            info.size = 5
            tar.addfile(info, io.BytesIO(b"never"))
        report = h.inspect_archives(self.root, self.root / ".expanded")
        self.assertEqual(report["blockers"][0]["member"], "hidden/.env")
        self.assertFalse(any(p.is_file() for p in (self.root / ".expanded").rglob("*")))

    def test_nested_safe_archive_scans_hidden_text_and_rejects_escape(self):
        archive = self.root / "nested.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            for name in [".hidden/ordinary.txt", "../../escape.txt"]:
                info = tarfile.TarInfo(name)
                info.size = 4
                tar.addfile(info, io.BytesIO(b"data"))
        report = h.inspect_archives(self.root, self.root / ".expanded")
        self.assertTrue(any(r["reason"] == "unsafe-member-path" for r in report["blockers"]))
        self.assertTrue(any(p.read_bytes() == b"data" for p in (self.root / ".expanded").rglob("*.txt")))

    def test_pack_requires_scan_and_verifies_split_round_trip(self):
        (self.root / "file.txt").write_bytes(b"content" * 1000)
        out = self.root / ".handoff/run"
        h.capture(self.root, out)
        with self.assertRaises(RuntimeError):
            h.pack(out, part_bytes=100)
        h.write_json(out / "scan.json", {"approved": True, "tree_digest": h.tree_digest(out / "tree")})
        summary = h.pack(out, part_bytes=100)
        self.assertTrue(all(p["bytes"] <= 100 for p in summary["parts"]))
        self.assertTrue(h.verify(out)["verified"])
        (out / "tree/file.txt").write_bytes(b"changed")
        with self.assertRaises(RuntimeError):
            h.pack(out, part_bytes=100)

    def test_plaintext_scan_includes_vendor_hidden_files_and_never_follows_links(self):
        out = self.root / ".handoff/run"
        tree = out / "tree"
        (tree / "node_modules/.hidden").mkdir(parents=True)
        (tree / "node_modules/.hidden/test.txt").write_bytes(b"plain fixture")
        (tree / "asset.glb").write_bytes(b"binary\0bytes")
        (tree / "outside").symlink_to("/nonexistent")
        rows = h.prepare_plaintext(out)
        text = next(r for r in rows if r["path"].endswith("test.txt"))
        self.assertEqual((out / "plaintext" / text["scanner_file"]).read_bytes(), b"plain fixture")
        self.assertEqual(next(r for r in rows if r["path"] == "asset.glb")["scan_kind"], "binary-not-string-scanned")
        self.assertFalse(any(r["path"] == "outside" for r in rows))

    def test_stable_copy_rejects_symlink_in_place_of_file(self):
        source = self.root / "link"
        source.symlink_to("/nonexistent")
        with self.assertRaises(RuntimeError):
            h.stable_copy(source, self.root / "dest")

    def test_changed_archive_parts_fail_verification(self):
        (self.root / "file.txt").write_bytes(b"payload")
        out = self.root / ".handoff/run"
        h.capture(self.root, out)
        h.write_json(out / "scan.json", {"approved": True, "tree_digest": h.tree_digest(out / "tree")})
        result = h.pack(out, part_bytes=100)
        (out / result["parts"][0]["path"]).write_bytes(b"damaged")
        with self.assertRaises(RuntimeError):
            h.verify(out)


if __name__ == "__main__":
    unittest.main()
