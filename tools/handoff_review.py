"""Print metadata and masked code shape only, never finding values."""
import argparse
import hashlib
import json
import re
import socket
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run")
    parser.add_argument("--summary", action="store_true")
    parser.add_argument("--save", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    out = root / ".handoff" / args.run
    composition = json.loads((out / "archive-composition.json").read_text())
    members = {r["scanner_file"]: r for r in composition["members"] if "scanner_file" in r}
    plaintext = {r["scanner_file"]: r for r in json.loads((out / "plaintext-map.json").read_text()) if "scanner_file" in r} if (out / "plaintext-map.json").exists() else {}
    rows = []
    for scope in ["tree", "plaintext", "expanded"]:
        if not (out / f"gitleaks-{scope}.json").exists():
            continue
        findings = json.loads((out / f"gitleaks-{scope}.json").read_text())
        for finding in findings:
            path = out / scope / finding["path"]
            member = members.get(finding["path"], {}) if scope == "expanded" else plaintext.get(finding["path"], {}) if scope == "plaintext" else {}
            lines = path.read_text(errors="replace").splitlines()
            line = lines[finding["line"] - 1]
            # Only shape, all literals and long tokens are masked before output.
            masked = re.sub(r'([\'"`])(?:\\.|(?!\1).)*?\1', '"[MASKED]"', line)
            masked = re.sub(r'[A-Za-z0-9_+/=.-]{16,}', '[MASKED-TOKEN]', masked)
            facts = {}
            if scope == "plaintext" and "node_modules/" in member.get("path", ""):
                dependency_path = member["path"].split("node_modules/", 1)[1]
                clean = root / ".handoff/t/src/node_modules" / dependency_path
                facts["identical_to_clean_npm_ci"] = clean.is_file() and hashlib.sha256(clean.read_bytes()).hexdigest() == finding["sha256"]
                facts["dependency_path"] = dependency_path
            try:
                data = json.loads(line).get("snapshot", {})
                request = data.get("request", {})
                url = urlsplit(request.get("url", ""))
                response = data.get("response", {})
                protocols = [v.get("value") for v in request.get("headers", []) if v.get("name", "").lower() == "sec-websocket-protocol"]
                listening = None
                if url.hostname == "127.0.0.1" and url.port:
                    with socket.socket() as probe:
                        probe.settimeout(0.5)
                        listening = probe.connect_ex(("127.0.0.1", url.port)) == 0
                if data:
                    facts.update({"scheme": url.scheme, "host": url.hostname, "port": url.port, "loopback_port_listening": listening, "vite_hmr_protocol": protocols == ["vite-hmr"], "path": url.path, "query_keys": [key for key, _ in parse_qsl(url.query)], "request_header_names": [v.get("name") for v in request.get("headers", [])], "request_cookie_count": len(request.get("cookies", [])), "response_header_names": [v.get("name") for v in response.get("headers", [])], "response_cookie_count": len(response.get("cookies", [])), "response_content_keys": list(response.get("content", {}))})
            except (ValueError, AttributeError):
                pass
            rows.append({**finding, "source_path": member.get("path"), "archive": member.get("archive"), "member": member.get("member"), "facts": facts, "masked_line": masked[:250]})
    if args.save:
        (out / "review-metadata.json").write_text(json.dumps(rows, indent=2) + "\n")
    if args.summary:
        groups = {}
        for row in rows:
            key = (row["scope"], row["sha256"], row["rule"], row["line"])
            if key not in groups:
                groups[key] = {**row, "count": 0}
            groups[key]["count"] += 1
        rows = list(groups.values())
    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
