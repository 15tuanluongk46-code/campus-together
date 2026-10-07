"""Run clean-source checks without operating live services; logs stay in .handoff."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ".handoff" / "checks"
SOURCE = ROOT / ".handoff" / "t" / "src"


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def run():
    OUT.mkdir(parents=True, exist_ok=True)
    (SOURCE / ".superpowers").mkdir(exist_ok=True)
    env = {key: os.environ[key] for key in ("PATH", "HOME", "LANG", "DISPLAY", "XAUTHORITY") if key in os.environ}
    env.update({"npm_config_cache": str(ROOT / ".handoff/npm-cache"), "npm_config_audit": "false", "npm_config_fund": "false", "TMPDIR": str(OUT), "CAMPUS_TEST_PORT": "2867", "CAMPUS_CLIENT_PORT": "5473", "CAMPUS_EVIDENCE_DIR": str(OUT / "browser"), "CAMPUS_REPORT_DIR": str(OUT / "browser-report")})
    browser = shutil.which("google-chrome") or shutil.which("chromium")
    if browser:
        env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"] = browser
    commands = [
        ("install", ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], 240),
        ("typecheck", ["npm", "run", "typecheck"], 180),
        ("build", ["npm", "run", "build"], 180),
        ("full-vitest", ["npm", "test"], 1800),
        ("production-browser", ["npm", "run", "test:e2e:production"], 600),
    ]
    results = {"started": timestamp(), "source": str(SOURCE), "node": subprocess.check_output(["node", "--version"], text=True).strip(), "npm": subprocess.check_output(["npm", "--version"], text=True).strip(), "browser": browser, "checks": [], "status": "running"}

    def save():
        (OUT / "results.json").write_text(json.dumps(results, indent=2) + "\n")

    save()
    for name, command, timeout in commands:
        row = {"name": name, "command": command, "cwd": str(SOURCE), "started": timestamp(), "status": "running", "log": str(OUT / f"{name}.log")}
        results["checks"].append(row)
        save()
        try:
            with (OUT / f"{name}.log").open("w") as log:
                outcome = subprocess.run(command, cwd=SOURCE, env=env, stdout=log, stderr=log, timeout=timeout, check=False)
            row.update(exit_code=outcome.returncode, status="PASS" if outcome.returncode == 0 else "FAIL")
        except subprocess.TimeoutExpired:
            row.update(status="TIMEOUT")
        row["finished"] = timestamp()
        save()
        if row["status"] != "PASS" and name in {"install", "typecheck", "build"}:
            break
    results.update(status="finished", finished=timestamp())
    save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "run"])
    args = parser.parse_args()
    if args.action == "run":
        run()
    else:
        OUT.mkdir(parents=True, exist_ok=False)
        with (OUT / "runner.log").open("w") as log:
            child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "run"], cwd=ROOT, stdout=log, stderr=log, start_new_session=True)
        print(json.dumps({"pid": child.pid, "results": str(OUT / "results.json")}))


if __name__ == "__main__":
    main()
