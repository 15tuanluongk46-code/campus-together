"""Project-local, offline handoff: enumerate → stable capture → scan → pack → verify.

No uploads, Git writes, live-process operations, or automatic restore. Python 3.12+.
Generated evidence belongs exclusively in ROOT/.handoff/<run>.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import shutil
import stat
import subprocess
import tarfile
import tempfile
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

CHUNK = 1024 * 1024
ARCHIVES = (".tar.gz", ".tgz", ".tar", ".zip", ".gz", ".tar.xz", ".tar.bz2")
UNSUPPORTED = (".7z", ".rar", ".zst", ".xz", ".bz2")
SECRET_DIRS = {".ssh", ".gnupg", "keys", "secrets", "vault", "browser-profile", "chrome-profile", "chrome-ai", "user-data", "user_data", "user-data-dir"}
SECRET_NAMES = {".env", ".npmrc", ".pypirc", ".netrc", "cert.pem", "credentials.json", "cookies.json", "cookies.txt", "storage-state.json", "storagestate.json", "login data", "cookies", "local state", "id_rsa", "id_ed25519"}


def now():
    return datetime.now(timezone.utc).isoformat()


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def sha_file(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def sensitive(path):
    parts = [p.lower() for p in PurePosixPath(path).parts]
    name = parts[-1] if parts else ""
    if any(p in SECRET_DIRS for p in parts):
        return True
    if name in SECRET_NAMES or name.endswith((".key", ".p12", ".pfx", ".session", ".session-journal")):
        return True
    if name.startswith(".env.") and name not in {".env.example", ".env.sample", ".env.template"}:
        return True
    return any(p in {".cloudflare", ".cloudflared"} for p in parts) and name.endswith((".pem", ".json")) and name not in {"cloudflared.json", "tunnel-process.json"}


def excluded(path):
    if path == ".handoff" or path.startswith(".handoff/"):
        return "own-handoff-output-no-recursion"
    if ".git" in PurePosixPath(path).parts:
        return "git-history-controller-owned"
    if sensitive(path):
        return "known-sensitive-path-no-read-copy-scan; encryption-policy-required"
    return None


def walk(root):
    """Metadata-only traversal, never follow symlinks or descend own output/secrets."""
    def descend(directory):
        with os.scandir(directory) as it:
            entries = sorted(it, key=lambda item: item.name)
        for entry in entries:
            path = Path(entry.path)
            rel = path.relative_to(root).as_posix()
            yield rel, path, path.lstat()
            # .git metadata is enumerated; content is never opened.
            if entry.is_dir(follow_symlinks=False) and rel != ".handoff" and not sensitive(rel):
                yield from descend(path)
    yield from descend(root)


def signature(st):
    return (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns, st.st_mode)


def kind(mode):
    for check, name in [(stat.S_ISREG, "file"), (stat.S_ISDIR, "directory"), (stat.S_ISLNK, "symlink"), (stat.S_ISSOCK, "socket"), (stat.S_ISFIFO, "fifo"), (stat.S_ISCHR, "character-device"), (stat.S_ISBLK, "block-device")]:
        if check(mode):
            return name
    return "special"


def inventory(root, hash_content=False):
    rows = []
    for rel, path, st in walk(root):
        reason = excluded(rel)
        typ = kind(st.st_mode)
        row = {"path": rel, "type": typ, "mode": oct(stat.S_IMODE(st.st_mode)), "bytes": st.st_size, "mtime_ns": st.st_mtime_ns, "sha256": None, "reason": reason,
               "disposition": "excluded" if reason else "include" if typ in {"file", "directory", "symlink"} else "metadata-only"}
        if typ == "symlink":
            row["target"] = os.readlink(path)
        if typ not in {"file", "directory", "symlink"} and not reason:
            row["reason"] = "runtime-special-never-open-or-restore"
        if typ == "directory" and (sensitive(rel) or rel == ".handoff"):
            row["subtree"] = "not-enumerated-by-policy"
        if hash_content and typ == "file" and not reason:
            row["sha256"] = sha_file(path)
            row["stable_during_hash"] = signature(st) == signature(path.lstat())
        if rel.endswith(".pid") or "process.json" in rel:
            row["restore_policy"] = "historical-record-only; never use to signal/restart/restore automatically"
        rows.append(row)
    return rows


def summarize(rows):
    sizes = Counter()
    for row in rows:
        if row["type"] == "file":
            sizes[row["path"].split("/")[0]] += row["bytes"]
    return {"entries": len(rows), "regular_files": sum(r["type"] == "file" for r in rows), "regular_bytes": sum(sizes.values()), "top_level_bytes": dict(sizes.most_common()),
            "types": dict(Counter(r["type"] for r in rows)), "dispositions": dict(Counter(r["disposition"] for r in rows)),
            "sensitive_candidates": [r["path"] for r in rows if sensitive(r["path"])],
            "operational_review_candidates": [r["path"] for r in rows if r["type"] == "file" and (".cloudflare/" in r["path"] or r["path"].endswith((".log", ".pid")))]}


def stable_copy(source, target, attempts=3):
    target.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(attempts):
        started = now()
        before = source.lstat()
        if not stat.S_ISREG(before.st_mode):
            raise RuntimeError(f"Source type changed: {source.name}")
        fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        h = hashlib.sha256()
        try:
            with os.fdopen(fd, "rb") as src, target.open("wb") as dst:
                if signature(os.fstat(src.fileno())) != signature(before):
                    raise RuntimeError("Source identity changed before read")
                for block in iter(lambda: src.read(CHUNK), b""):
                    dst.write(block)
                    h.update(block)
                after_fd = os.fstat(src.fileno())
            after = source.lstat()
            if signature(before) == signature(after_fd) == signature(after):
                target.chmod(stat.S_IMODE(before.st_mode))
                os.utime(target, ns=(before.st_atime_ns, before.st_mtime_ns))
                digest = h.hexdigest()
                if sha_file(target) != digest:
                    raise RuntimeError("Staged copy hash mismatch")
                return {"sha256": digest, "bytes": before.st_size, "mode": oct(stat.S_IMODE(before.st_mode)), "mtime_ns": before.st_mtime_ns, "capture_started": started, "capture_finished": now(), "attempts": attempt + 1, "source_signature": list(signature(before))}
        except Exception:
            target.unlink(missing_ok=True)
            raise
        target.unlink(missing_ok=True)
    raise RuntimeError(f"Source kept changing; capture refused: {source.name}")


def is_archive(name):
    return name.lower().endswith(ARCHIVES)


def inspect_archives(root, expanded):
    """Never filesystem-extract member paths. Safe contents get numbered scanner files.

    Inventory ALL members including dotfiles; recurse through nested archives. Known
    sensitive members are reported by path without opening their member streams.
    """
    expanded.mkdir(parents=True, exist_ok=True)
    report = {"archives": [], "members": [], "blockers": [], "expanded_bytes": 0, "top_level_sha256": {}}
    budget = max(0, shutil.disk_usage(expanded).free - 2 * 1024**3)

    def inspect(stream, label, depth):
        if depth > 12:
            report["blockers"].append({"archive": label, "reason": "archive-depth-over-12"})
            return
        report["archives"].append(label)

        def member(name, size, typ, opener, target=None):
            row = {"archive": label, "member": name, "bytes": size, "type": typ}
            if target is not None:
                row["target"] = target
            report["members"].append(row)
            parts = PurePosixPath(name)
            if parts.is_absolute() or ".." in parts.parts or "\\" in name:
                report["blockers"].append({**row, "reason": "unsafe-member-path"})
                return
            if sensitive(name) or ".git" in parts.parts:
                report["blockers"].append({**row, "reason": "sensitive-or-git-member-not-opened"})
                return
            if typ != "file":
                return
            if report["expanded_bytes"] + size > budget:
                report["blockers"].append({**row, "reason": "expanded-size-exceeds-free-space-budget"})
                return
            ext = ".archive" if is_archive(name) else ".txt"
            destination = expanded / f"{len(report['members']):08d}{ext}"
            with opener() as src, destination.open("wb") as dst:
                shutil.copyfileobj(src, dst, CHUNK)
            report["expanded_bytes"] += destination.stat().st_size
            row["scanner_file"] = destination.name
            row["sha256"] = sha_file(destination)
            if is_archive(name):
                with destination.open("rb") as nested:
                    inspect(nested, f"{label}!{name}", depth + 1)
                destination.unlink()
            elif name.lower().endswith(UNSUPPORTED):
                report["blockers"].append({**row, "reason": "unsupported-compressed-content"})

        try:
            lower = label.lower()
            if lower.endswith(".zip"):
                with zipfile.ZipFile(stream) as archive:
                    for info in archive.infolist():
                        typ = "directory" if info.is_dir() else "symlink" if stat.S_ISLNK(info.external_attr >> 16) else "file"
                        if info.flag_bits & 1:
                            report["blockers"].append({"archive": label, "member": info.filename, "reason": "encrypted-member-unscannable"})
                            continue
                        member(info.filename, info.file_size, typ, lambda i=info: archive.open(i))
            elif lower.endswith(".gz") and not lower.endswith((".tar.gz", ".tgz")):
                with gzip.GzipFile(fileobj=stream) as source, tempfile.TemporaryFile(dir=expanded) as tmp:
                    total = 0
                    for block in iter(lambda: source.read(CHUNK), b""):
                        total += len(block)
                        if total > budget:
                            raise RuntimeError("gzip exceeds space budget")
                        tmp.write(block)
                    tmp.seek(0)
                    member(PurePosixPath(label[:-3]).name, total, "file", lambda: io.BytesIO(tmp.read()))
            else:
                with tarfile.open(fileobj=stream, mode="r:*") as archive:
                    for info in archive:
                        typ = "file" if info.isfile() else "directory" if info.isdir() else "symlink" if info.issym() else "hardlink" if info.islnk() else "special"
                        member(info.name, info.size, typ, lambda i=info: archive.extractfile(i), info.linkname if info.issym() or info.islnk() else None)
        except (tarfile.TarError, zipfile.BadZipFile, OSError, RuntimeError, EOFError) as error:
            report["blockers"].append({"archive": label, "reason": f"archive-inspection-failed:{type(error).__name__}"})

    for rel, path, st in walk(root):
        if expanded == path or expanded in path.parents or excluded(rel) or not stat.S_ISREG(st.st_mode):
            continue
        if is_archive(rel):
            before = signature(path.lstat())
            report["top_level_sha256"][rel] = sha_file(path)
            with path.open("rb") as stream:
                inspect(stream, rel, 0)
            if before != signature(path.lstat()):
                report["blockers"].append({"archive": rel, "reason": "archive-changed-during-inspection"})
        elif rel.lower().endswith(UNSUPPORTED):
            report["blockers"].append({"archive": rel, "reason": "unsupported-compressed-content"})
    return report


def capture(root, out):
    out.mkdir(parents=True, exist_ok=False)
    out.chmod(0o700)
    started = now()
    rows = inventory(root)
    summary = summarize(rows)
    write_json(out / "preflight.json", {"started": started, "free_bytes": shutil.disk_usage(out).free, "summary": summary})
    needed = sum(r["bytes"] for r in rows if r["type"] == "file" and r["disposition"] == "include")
    if shutil.disk_usage(out).free < needed * 3 + 2 * 1024**3:
        raise RuntimeError("Insufficient space for stable staging + archive + verification; inventory preserved")
    # Inspect nested known-credential paths BEFORE copying their containing archives.
    composition = inspect_archives(root, out / "expanded")
    write_json(out / "archive-composition.json", composition)
    blocked_archives = {r["archive"].split("!")[0] for r in composition["blockers"]}
    tree = out / "tree"
    tree.mkdir()
    for row in rows:
        rel = row["path"]
        if row["disposition"] != "include":
            continue
        src, dst = root / rel, tree / rel
        if rel in blocked_archives:
            row.update(disposition="excluded", reason="nested-archive-blocker; see archive-composition.json")
        elif row["type"] == "directory":
            dst.mkdir(parents=True, exist_ok=True)
        elif row["type"] == "file":
            row.update(stable_copy(src, dst))
            inspected_hash = composition["top_level_sha256"].get(rel)
            if inspected_hash and inspected_hash != row["sha256"]:
                raise RuntimeError(f"Archive changed after inspection: {rel}")
        elif row["type"] == "symlink":
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.symlink_to(row["target"])
    # Directory timestamps/modes after all children exist.
    for row in reversed(rows):
        if row["type"] == "directory" and row["disposition"] == "include":
            (tree / row["path"]).chmod(int(row["mode"], 8))
    manifest = {"schema": 1, "root_name": root.name, "capture_started": started, "capture_finished": now(), "consistency": "per-file stable bytes; non-atomic live tree; no processes paused", "entries": rows, "summary": summarize(rows), "archive_blockers": composition["blockers"]}
    write_json(out / "manifest.json", manifest)
    source_list = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root, capture_output=True, check=False)
    paths = sorted({p for p in source_list.stdout.decode().split("\0") if p})
    safe = {r["path"] for r in rows if r["disposition"] == "include" and r["type"] in {"file", "symlink"}}
    write_json(out / "intended-git-files.json", [p for p in paths if p in safe])
    (out / "intended-git-files.nul").write_bytes(b"\0".join(p.encode() for p in paths if p in safe) + b"\0")
    write_json(out / "source-delta.json", source_delta(root, rows))
    return manifest


def source_delta(root, rows):
    current = {r: st for r, _p, st in walk(root) if not excluded(r)}
    original = {r["path"]: r for r in rows if r["disposition"] in {"include", "metadata-only"}}
    changed = [p for p, row in original.items() if row.get("source_signature") and p in current and list(signature(current[p])) != row["source_signature"]]
    return {"checked": now(), "changed_since_capture": changed, "added": sorted(set(current) - set(original)), "removed": sorted(set(original) - set(current)), "note": "Capture preserves stable per-file versions; delta is not silently refreshed."}


def tree_digest(root):
    records = []
    for rel, path, st in walk(root):
        records.append([rel, kind(st.st_mode), stat.S_IMODE(st.st_mode), sha_file(path) if stat.S_ISREG(st.st_mode) else os.readlink(path) if stat.S_ISLNK(st.st_mode) else None])
    return hashlib.sha256(json.dumps(records, separators=(",", ":")).encode()).hexdigest()


def prepare_plaintext(out):
    """Flat scanner paths prevent vendor/test path exclusions hiding plaintext.

    Hardlinks target the immutable local staging copy, never original live files.
    Binary prefix sniff only: no strings extraction from binary assets.
    """
    target = out / "plaintext"
    target.mkdir(exist_ok=True)
    records = []
    for rel, path, st in walk(out / "tree"):
        if not stat.S_ISREG(st.st_mode):
            continue
        with path.open("rb") as source:
            prefix = source.read(8192)
        text = b"\0" not in prefix
        try:
            prefix.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = False
        record = {"path": rel, "bytes": st.st_size, "scan_kind": "plaintext" if text else "binary-not-string-scanned"}
        if text:
            scanner_path = target / f"{len(records):08d}.txt"
            if not scanner_path.exists():
                os.link(path, scanner_path)
            elif sha_file(scanner_path) != sha_file(path):
                raise RuntimeError("Plaintext staging mismatch")
            record["scanner_file"] = scanner_path.name
        records.append(record)
    write_json(out / "plaintext-map.json", records)
    return records


def scan(out, triage=None):
    tree = out / "tree"
    manifest = json.loads((out / "manifest.json").read_text())
    scanner = shutil.which("gitleaks")
    if not scanner:
        raise RuntimeError("gitleaks unavailable")
    # Never inherit user configuration/allowlists that could mask a finding.
    env = {k: v for k, v in os.environ.items() if not k.startswith("GITLEAKS_")}
    config = out / "scanner-defaults.toml"
    config.write_text('''[extend]
useDefault = true
[[rules]]
id = "cloudflare-tunnel-material"
description = "Cloudflare tunnel credential fields or CLI token"
regex = \'\'\'(?i)(?:tunnelsecret|tunnel_token|tunnel-token|--token)["\\s:=]+([A-Za-z0-9_+/=-]{20,})\'\'\'
secretGroup = 1
''')
    ignores = out / "empty-ignore"
    ignores.write_text("")
    prepare_plaintext(out)
    findings, executions = [], []
    for label, path in [("tree", tree), ("plaintext", out / "plaintext"), ("expanded", out / "expanded")]:
        report = out / f"gitleaks-{label}.json"
        command = [scanner, "dir", str(path), "--redact=100", "--no-banner", "--no-color", "--ignore-gitleaks-allow", "--config", str(config), "--gitleaks-ignore-path", str(ignores), "--max-decode-depth", "10", "--report-format", "json", "--report-path", str(report)]
        with (out / f"gitleaks-{label}.log").open("w") as log:
            result = subprocess.run(command, env=env, stdout=log, stderr=log, check=False)
        if result.returncode not in (0, 1) or not report.exists():
            raise RuntimeError(f"Scanner failure ({label}); see redacted log")
        raw = json.loads(report.read_text())
        safe_findings = []
        for item in raw:
            file = item["File"]
            local = Path(file) if Path(file).is_absolute() else path / file
            relative = local.relative_to(path).as_posix()
            safe = {"scope": label, "path": relative, "rule": item["RuleID"], "line": item["StartLine"], "end_line": item["EndLine"], "sha256": sha_file(local)}
            safe["id"] = hashlib.sha256(json.dumps(safe, sort_keys=True).encode()).hexdigest()
            safe_findings.append(safe)
        # Redacted originals are replaced with a strict metadata-only schema.
        write_json(report, safe_findings)
        findings.extend(safe_findings)
        executions.append({"scope": label, "exit_code": result.returncode, "command": command})
    reviewed = json.loads(triage.read_text()) if triage else []
    accepted = {r["id"]: r for r in reviewed if r.get("classification") == "false-positive" and r.get("reason")}
    unresolved = [f for f in findings if f["id"] not in accepted]
    sensitive_paths = manifest["summary"]["sensitive_candidates"]
    result = {"scanned_at": now(), "gitleaks_version": subprocess.check_output([scanner, "version"], text=True).strip(), "tree_digest": tree_digest(tree), "expanded_digest": tree_digest(out / "expanded"), "executions": executions, "findings": findings, "triage": [accepted[f["id"]] for f in findings if f["id"] in accepted], "unresolved": unresolved, "sensitive_paths_not_read": sensitive_paths, "archive_blockers": manifest["archive_blockers"], "approved": not unresolved and not sensitive_paths and not manifest["archive_blockers"]}
    write_json(out / "scan.json", result)
    return {"approved": result["approved"], "findings": len(findings), "unresolved": len(unresolved), "sensitive_paths": sensitive_paths, "archive_blockers": len(manifest["archive_blockers"])}


def evidence(root, out):
    """Generate metadata-only final review inputs in the requested report directory."""
    report_dir = root / ".superpowers/sdd/github-handoff"
    paths = sorted({p for p in subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root).decode().split("\0") if p})
    files = []
    for rel in paths:
        if excluded(rel):
            raise RuntimeError(f"Excluded intended source: {rel}")
        path = root / rel
        st = path.lstat()
        files.append({"path": rel, "bytes": st.st_size, "mode": oct(stat.S_IMODE(st.st_mode)), "sha256": sha_file(path) if stat.S_ISREG(st.st_mode) else None, "type": kind(st.st_mode)})
    write_json(report_dir / "intended-git-files.json", files)
    (report_dir / "intended-git-files.nul").write_bytes(b"\0".join(r["path"].encode() for r in files) + b"\0")
    scan_result = json.loads((out / "scan.json").read_text())
    composition = json.loads((out / "archive-composition.json").read_text())
    manifest = json.loads((out / "manifest.json").read_text())
    checks = json.loads((root / ".handoff/checks/results.json").read_text())
    result = {"generated": now(), "audit_run": out.name, "checks": checks, "scan": scan_result, "inventory": manifest["summary"], "archive_composition": {"archives": len(composition["archives"]), "members": len(composition["members"]), "expanded_bytes": composition["expanded_bytes"], "blockers": composition["blockers"]}, "intended_git": {"files": len(files), "bytes": sum(r["bytes"] for r in files), "max_file_bytes": max(r["bytes"] for r in files), "manifest": "intended-git-files.json"}}
    write_json(report_dir / "evidence.json", result)
    return {"path": str(report_dir / "evidence.json"), "intended_git": result["intended_git"], "archive_composition": result["archive_composition"]}


def pack(out, part_bytes=950_000_000):
    if not 1 <= part_bytes < 1_000_000_000:
        raise ValueError("parts must be strictly under 1GB")
    scan_path = out / "scan.json"
    if not scan_path.exists():
        raise RuntimeError("No completed secret scan")
    approval = json.loads(scan_path.read_text())
    if not approval.get("approved") or approval["tree_digest"] != tree_digest(out / "tree"):
        raise RuntimeError("Unresolved blockers or tree changed since scan")
    if approval.get("expanded_digest") and approval["expanded_digest"] != tree_digest(out / "expanded"):
        raise RuntimeError("Expanded archive content changed after scan")
    manifest = json.loads((out / "manifest.json").read_text())
    if manifest["archive_blockers"] or manifest["summary"]["sensitive_candidates"]:
        raise RuntimeError("Cannot archive unresolved sensitive paths")
    archive = out / "campus-together-full.tar.gz"
    if archive.exists() or (out / "parts.json").exists():
        raise RuntimeError("Refusing to overwrite existing archive; use a new run")
    with archive.open("xb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0) as zipped, tarfile.open(fileobj=zipped, mode="w|", format=tarfile.PAX_FORMAT) as tar:
        for row in manifest["entries"]:
            if row["disposition"] != "include":
                continue
            path = out / "tree" / row["path"]
            info = tar.gettarinfo(str(path), arcname="project/" + row["path"])
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            # Manifest retains historical mtimes; normalized archive is reproducible.
            info.mtime = 0
            if info.isfile():
                if sha_file(path) != row["sha256"]:
                    raise RuntimeError(f"Manifest mismatch: {row['path']}")
                with path.open("rb") as source:
                    tar.addfile(info, source)
            else:
                tar.addfile(info)
        for name in ["manifest.json", "scan.json", "archive-composition.json", "intended-git-files.json", "source-delta.json"]:
            path = out / name
            info = tar.gettarinfo(str(path), arcname="handoff-metadata/" + name)
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mtime = 0
            with path.open("rb") as source:
                tar.addfile(info, source)
    parts = []
    with archive.open("rb") as source:
        while True:
            block = source.read(min(CHUNK, part_bytes))
            if not block:
                break
            path = out / f"campus-together-full.tar.gz.part{len(parts) + 1:04d}"
            remaining = part_bytes
            with path.open("xb") as target:
                while block:
                    target.write(block)
                    remaining -= len(block)
                    if remaining == 0:
                        break
                    block = source.read(min(CHUNK, remaining))
            parts.append({"path": path.name, "bytes": path.stat().st_size, "sha256": sha_file(path)})
    metadata = {name: sha_file(out / name) for name in ["manifest.json", "scan.json", "archive-composition.json", "intended-git-files.json", "source-delta.json"]}
    result = {"format": "concatenate parts in listed order, then gzip/tar; never auto-restore runtime", "archive_bytes": archive.stat().st_size, "archive_sha256": sha_file(archive), "parts": parts, "manifest_sha256": metadata["manifest.json"], "metadata_sha256": metadata}
    write_json(out / "parts.json", result)
    (out / "SHA256SUMS").write_text("".join(f"{p['sha256']}  {p['path']}\n" for p in parts))
    return result


def verify(out):
    parts = json.loads((out / "parts.json").read_text())
    combined = hashlib.sha256()
    with tempfile.TemporaryFile(dir=out) as joined:
        for part in parts["parts"]:
            path = out / part["path"]
            if path.stat().st_size != part["bytes"] or sha_file(path) != part["sha256"]:
                raise RuntimeError("Split-part integrity failure")
            with path.open("rb") as part_source:
                for block in iter(lambda: part_source.read(CHUNK), b""):
                    combined.update(block)
                    joined.write(block)
        if combined.hexdigest() != parts["archive_sha256"]:
            raise RuntimeError("Reassembled archive hash mismatch")
        joined.seek(0)
        manifest = json.loads((out / "manifest.json").read_text())
        expected = {"project/" + r["path"]: r for r in manifest["entries"] if r["disposition"] == "include"}
        seen = set()
        metadata_seen = set()
        with tarfile.open(fileobj=joined, mode="r:gz") as tar:
            for member in tar:
                if member.name.startswith("handoff-metadata/"):
                    name = member.name.removeprefix("handoff-metadata/")
                    if name not in parts["metadata_sha256"] or name in metadata_seen or not member.isfile():
                        raise RuntimeError("Unexpected metadata member")
                    metadata_seen.add(name)
                    metadata_source = tar.extractfile(member)
                    if metadata_source is None or hashlib.sha256(metadata_source.read()).hexdigest() != parts["metadata_sha256"][name]:
                        raise RuntimeError("Metadata hash mismatch")
                    continue
                row = expected.get(member.name)
                if not row or member.name in seen:
                    raise RuntimeError("Unexpected/duplicate archive member")
                seen.add(member.name)
                if member.mode != int(row["mode"], 8):
                    raise RuntimeError("Mode mismatch")
                if row["type"] == "file":
                    member_source = tar.extractfile(member)
                    if member_source is None:
                        raise RuntimeError("Missing regular file")
                    h = hashlib.sha256()
                    while block := member_source.read(CHUNK):
                        h.update(block)
                    if h.hexdigest() != row["sha256"] or member.size != row["bytes"]:
                        raise RuntimeError("Archived byte hash mismatch")
                elif row["type"] == "symlink" and (not member.issym() or member.linkname != row["target"]):
                    raise RuntimeError("Symlink target mismatch")
                elif row["type"] == "directory" and not member.isdir():
                    raise RuntimeError("Directory mismatch")
        if seen != set(expected):
            raise RuntimeError("Missing archive entries")
        if metadata_seen != set(parts["metadata_sha256"]):
            raise RuntimeError("Missing metadata entries")
    result = {"verified": True, "verified_at": now(), "entries": len(seen), "parts": len(parts["parts"]), "archive_sha256": combined.hexdigest()}
    write_json(out / "verification.json", result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["inventory", "capture", "scan", "pack", "verify", "delta", "source-copy", "evidence"])
    parser.add_argument("--run", default="snapshot-20261007")
    parser.add_argument("--triage", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if "/" in args.run or args.run in {".", ".."}:
        parser.error("run must be a single directory name")
    output = root / ".handoff"
    output.mkdir(exist_ok=True)
    output.chmod(0o700)
    out = output / args.run
    if args.action == "inventory":
        rows = inventory(root)
        result = {"time": now(), "free_bytes": shutil.disk_usage(root).free, "summary": summarize(rows), "entries": rows}
        write_json(output / f"{args.run}-inventory.json", result)
        print(json.dumps({k: result[k] for k in ["time", "free_bytes", "summary"]}, indent=2))
    elif args.action == "capture":
        result = capture(root, out)
        print(json.dumps(result["summary"], indent=2))
    elif args.action == "scan":
        print(json.dumps(scan(out, args.triage), indent=2))
    elif args.action == "evidence":
        print(json.dumps(evidence(root, out), indent=2))
    elif args.action == "pack":
        print(json.dumps(pack(out), indent=2))
    elif args.action == "verify":
        print(json.dumps(verify(out), indent=2))
    elif args.action == "delta":
        manifest = json.loads((out / "manifest.json").read_text())
        result = source_delta(root, manifest["entries"])
        write_json(out / "source-delta-latest.json", result)
        print(json.dumps(result, indent=2))
    elif args.action == "source-copy":
        target = out / "src"
        target.mkdir(parents=True, exist_ok=False)
        paths = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root).decode().split("\0")
        for rel in filter(None, paths):
            if excluded(rel):
                raise RuntimeError(f"Sensitive source candidate: {rel}")
            src, dst = root / rel, target / rel
            if src.is_symlink():
                raise RuntimeError(f"Source copy requires review of symlink: {rel}")
            stable_copy(src, dst)
        print(json.dumps({"source_check": str(target), "files": len(list(filter(None, paths)))}, indent=2))


if __name__ == "__main__":
    main()
