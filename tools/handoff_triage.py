"""Materialize only individually reviewed SHA/rule/line decisions; no path allowlist."""
import argparse
import hashlib
import json
from pathlib import Path

# Exact bytes verified against a fresh lockfile-based npm ci (2026-10-07).
VENDOR = {
    ("a10f0e1854f3316d7ee437b79649e5a6ae3ae14ffe6322b02d4987071a95362e", "generic-api-key", 517): ("@types/node/https.d.ts", "Public certificate pin SHA-256 in Node HTTPS documentation, not private material"),
    ("a10f0e1854f3316d7ee437b79649e5a6ae3ae14ffe6322b02d4987071a95362e", "generic-api-key", 520): ("@types/node/https.d.ts", "Public certificate pin SHA-256 in Node HTTPS documentation, not private material"),
    ("a10f0e1854f3316d7ee437b79649e5a6ae3ae14ffe6322b02d4987071a95362e", "generic-api-key", 523): ("@types/node/https.d.ts", "Public certificate pin SHA-256 in Node HTTPS documentation, not private material"),
    ("2546783e4f74a432bbccd88a6763cf78ac4e951686262cdf85b54d5a26ca3995", "generic-api-key", 5): ("playwright-core/lib/vite/traceViewer/assets/xtermModule-DywYcAf8.js", "Public distributed minified xterm trace-viewer code; exact upstream npm bytes, not project credentials"),
    ("026047366a9bdd0961eb79857fd5d84db204589942193012aabe7e3bee381045", "generic-api-key", 84): ("three/examples/jsm/libs/chevrotain.module.min.js", "Public distributed Chevrotain parser code/documentation; exact upstream npm bytes"),
    ("f4ebdab74387516508d0ce96a56979fe06af7e2425dccc13d34c0a229ba3a050", "jwt", 363): ("zod/src/v4/mini/tests/string.test.ts", "Public Zod JWT validation test fixture; exact upstream npm bytes"),
    ("f4ebdab74387516508d0ce96a56979fe06af7e2425dccc13d34c0a229ba3a050", "jwt", 366): ("zod/src/v4/mini/tests/string.test.ts", "Public Zod JWT validation test fixture; exact upstream npm bytes"),
    ("04f902a3638ff3c33f78ee3dacba72a1a9e87034f00d8eded5f65acf2adc0f3a", "generic-api-key", 424): ("zod/src/v4/classic/tests/string.test.ts", "Public Zod string-validation fixture; exact upstream npm bytes"),
    ("549070af3acabb3efcc4f55bfe6210f9f7c2fcf633cf7eaa59bfe60719969171", "generic-api-key", 39220): ("playwright-core/lib/coreBundle.js", "Public Playwright bundled protocol/example code; exact upstream npm bytes"),
}
HISTORICAL_HMR = {
    ("d1f5dc95698026fc6894d4e30b1090d92cb18923c1b2fab7350df311cb6e9b47", "generic-api-key", 15),
    ("3d7e731182b0db4a22515c4ee5bcd3073877b54b1d9fc2bc7459279ab941ccac", "generic-api-key", 63),
    ("a817c5541b27a37dc06d7c28e0f18382c794dada7092f47ed2267ce10d1ad557", "generic-api-key", 62),
    ("7b2afe3288ad8f8f91223a6e7798654f0fa767cccb4f1a0bf0ed21528e9586c7", "generic-api-key", 62),
    ("a50ce4e7b419e15a29be53d2910de750fe5d0e9dfe24cf13e41427d9cf4c590a", "generic-api-key", 81),
    ("5ee5cfdb3c31f51b705f3e3709ce93ef9023681ff836be765ad472b9b3505f72", "generic-api-key", 65),
    ("d802b782e5b5765914ded6d4dbbe50de1a031413e2535121dbd0c89db76ad97d", "generic-api-key", 65),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    out = root / ".handoff" / args.run
    review = json.loads((out / "review-metadata.json").read_text())
    decisions = []
    for row in review:
        key = (row["sha256"], row["rule"], row["line"])
        vendor = VENDOR.get(key)
        if row["scope"] == "plaintext" and vendor and row["facts"].get("identical_to_clean_npm_ci") and row["facts"].get("dependency_path") == vendor[0]:
            reason = vendor[1] + "; scope is exact file SHA256 + rule + line + source path, never all node_modules."
            decisions.append({"id": row["id"], "classification": "false-positive", "reason": reason, "source_path": row["source_path"], "sha256": row["sha256"], "rule": row["rule"], "line": row["line"]})
        elif row["scope"] == "expanded":
            facts = row["facts"]
            if key in HISTORICAL_HMR and facts.get("vite_hmr_protocol") and facts.get("loopback_port_listening") is False and facts.get("request_cookie_count") == 0 and facts.get("response_cookie_count") == 0:
                decisions.append({"id": row["id"], "classification": "false-positive", "reason": "Historical test Vite HMR per-config random nonce, not a generic API key; exact reviewed SHA/rule/line; vite-hmr on inactive loopback port, no cookies. Vite generates a fresh token on config creation.", "archive": row["archive"], "member": row["member"], "sha256": row["sha256"], "rule": row["rule"], "line": row["line"]})
    target = out / "triage-reviewed.json"
    target.write_text(json.dumps(decisions, indent=2) + "\n")
    print(json.dumps({"reviewed": len(decisions), "findings": len(review), "unresolved": len(review) - len(decisions), "triage": str(target), "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}))


if __name__ == "__main__":
    main()
