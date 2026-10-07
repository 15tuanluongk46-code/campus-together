# Cloudflare QuickTunnel pilot

> Cập nhật bàn giao 2026-10-07: nội dung “preparation/pending activation” bên dưới
> là runbook và trạng thái tại thời điểm soạn ban đầu. Sau đó đã có public smoke:
> `.superpowers/sdd/cloudflare/public-smoke-report.md` trong full snapshot ghi browser
> exit 0, SDK gameplay assertions PASS nhưng helper timeout, IP-spoof admission
> INCONCLUSIVE. Handoff không tái probe public URL/PID. Trên máy mới thay `PROJECT`
> bằng checkout thực, tạo private directory/config mới; không restore PID/socket cũ.

Approved scope: free public test, local machine stays on; no domain/account
changes. **Preparation only until controller activation.** The pre-existing
localhost process must stay running until the controller explicitly replaces it.

## Trust boundary

Set `CAMPUS_CLOUDFLARE_SOCKET_DIR` to opt into a second HTTP/WebSocket listener.
It must already exist, be absolute/canonical (no symlinks), owned by the process
UID and mode **0700**. The app binds `origin.sock`, chmods it to **0600**, and
refuses an occupied/stale path without deleting anything. The full socket path
is limited to 103 bytes. A failure starting either listener unwinds the server.
Graceful shutdown drains admission first, waits for initialization and room
disposal, closes the Unix connections (including upgrades), and removes the
bound socket. SIGKILL can leave a stale socket: inspect its owner before manual
cleanup; startup never guesses that it is stale.

Only dispatch through this listener accepts exactly one `CF-Connecting-IP`,
validated as one bare IPv4/IPv6 address. Missing, duplicate, comma lists, ports,
brackets, zone IDs and malformed addresses fail with 400 on **HTTP and WS**.
IPv6 variants and IPv4-mapped aliases canonicalize into the existing admission
owner. No XFF, bearer token, custom “trusted” header, or loopback source IP grants
trust. Incoming forwarding metadata is removed on both listeners; only the Unix
boundary synthesizes the validated IP into the pinned framework auth context.
The ordinary TCP listener always retains peer-socket accounting, even with
`CF-Connecting-IP`. Do not point cloudflared at TCP: all visitors would share the
proxy's six-token bucket.

The Unix listener shares the same process/rooms/admission owner: burst **6** per
canonical visitor IP, refill **1/10 s**, **32** initializing + live rooms, at most
**4096** identities, **10 min** idle expiry. Creation and joinOrCreate are charged
before parsing. Joining/reconnecting existing reservations doesn't spend a create
token. Defaults remain unchanged; these are pilot limits, not DDoS protection.
Operator readiness accepts HTTP 200 with `status: ready` and any positive safe
integer `capacity`, including an explicit `CAMPUS_MAX_ROOMS` override. It does not
require the default 32 or change the configured admission limit.

Filesystem access is the capability. Other processes with the **same UID**, root,
or authority to replace the private directory/its ancestors remain trusted.
This is not isolation from compromised local user code. Run cloudflared and the
app as the same user; keep the directory and ancestors under trusted ownership.
No reusable gateway secret is created or sent by a browser.

Cloudflare is trusted to supply/overwrite `CF-Connecting-IP` at its edge. Its
official docs describe Worker subrequest semantics and Pseudo IPv4 exceptions;
cross-zone Workers may share Cloudflare's fixed Worker IP. Do not enable Workers,
header transformations or alternate upstream proxies for this pilot. IP budgets
are not user accounts; NAT users can share a bucket. Actual edge spoofing, HTTPS
and WSS must still be checked after controller activation.

## Exposed surface

The trusted HTTP channel permits only game index/favicon/assets, `/health`,
aggregate `/ready`, and known matchmaking operations. WS upgrades must address
this process and an existing game room; normal Colyseus seat/token validation
still applies. No project files, admin, debugger, metrics, generic framework ping,
directory listing, or browser CDP forwarding. Static content comes only from
`apps/client/dist`. No frontend changes or build-time external server URL.

Existing Colyseus CORS policy is preserved (including its configured hook); the
default public-game policy permits cross-origin matchmaking. CORS is not access
control or tunnel authentication, and WebSocket origins are not an authorization
boundary. This guest game has no cookie-based account authentication; possession
of room/seat/reconnect capabilities governs admission. Do not add cookie-authenticated
admin or user APIs under this public policy without a separate security design.

## Pin and official references

- cloudflared **2026.10.0**, Linux amd64, official GitHub release executable.
- SHA-256: `d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db`
- Release metadata: <https://api.github.com/repos/cloudflare/cloudflared/releases/tags/2026.10.0>
- QuickTunnel: <https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/>
- Headers: <https://developers.cloudflare.com/fundamentals/reference/http-headers/>
- Pinned source: `cmd/cloudflared/tunnel/{cmd,quick_tunnel,configuration}.go`,
  `ingress/ingress.go` at <https://github.com/cloudflare/cloudflared/tree/2026.10.0>.
- Colyseus lock: core **0.18.18**, ws-transport **0.18.4**, SDK **0.18.5**.
  The actual installed request router, Node adapter, auth context and WS upgrade
  implementation were inspected; Express alone cannot guard matchmaking.

**Pinned CLI detail:** `--unix-socket` exists but alone does not select QuickTunnel
in `TunnelCommand`. `--url http://127.0.0.1:1` selects QuickTunnel; a separately
validated config with a single `unix:` ingress takes precedence in
`ParseIngressFromConfigAndCLI`. Port 1 is an intentionally unusable fallback,
never the game TCP port. `ingress validate` is run **without** `--url`: that
validation subcommand rejects mixing URL and ingress even though the pinned
runtime selects config ingress first. Keep the binary pin and this source check
together; don't substitute a new release without re-verification.
Local config/rule validation and the fake loopback provisioning probe establish
pinned CLI behavior only. **Actual public traffic choosing Unix ingress instead
of the dummy URL remains a pending post-activation smoke check**, along with edge
header overwrite, HTTPS and WSS. No successful public forwarding is claimed here.

## Controller runbook (commands are not activation evidence)

From the project root, after reviewing the report/artifact SHA:

```sh
PROJECT=/home/sss/AI-Home/projects/campus-together
SHA=<reviewed-archive-sha256>
RUNTIME="$PROJECT/releases/$SHA"
PRIVATE="$PROJECT/.cloudflare"
mkdir -m 700 "$PRIVATE"                   # fresh directory; never silently chmod user data
mkdir "$RUNTIME"                          # fresh extraction only
tar -xzf "$PROJECT/artifacts/sha256/$SHA.tar.gz" -C "$RUNTIME"
# Run in RUNTIME:
node tools/verify-runtime.mjs
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
```

Start the new game runtime in a foreground terminal/supervisor, **from RUNTIME**.
Use a spare loopback port (2568 below) to retain the old 2567 process:

```sh
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production HOST=127.0.0.1 PORT=2568 \
  CAMPUS_CLOUDFLARE_SOCKET_DIR="$PRIVATE" \
  node apps/server/dist/index.js
```

The archive excludes binaries and private state. Use the reviewed operator from
the checkout (already has `tools/bin/cloudflared-2026.10.0`); it rehashes the
executable on every validate/start. It inherits no `TUNNEL_*`, account tokens,
proxy settings or Node injection variables. `HOME` for cloudflared is PRIVATE;
config is explicit, autoupdate disabled, diagnostics disabled, metrics loopback.

```sh
node "$PROJECT/tools/cloudflare.mjs" prepare "$PRIVATE"
node "$PROJECT/tools/cloudflare.mjs" validate "$PRIVATE"
curl --fail --unix-socket "$PRIVATE/origin.sock" -H 'CF-Connecting-IP: 127.0.0.1' http://localhost/ready
curl --fail http://127.0.0.1:2568/health

# ONLY after controller approval; foreground, creates public random hostname:
node "$PROJECT/tools/cloudflare.mjs" tunnel "$PRIVATE" --activate-public
# Other terminal:
node "$PROJECT/tools/cloudflare.mjs" status "$PRIVATE"
node "$PROJECT/tools/cloudflare.mjs" stop "$PRIVATE"
```

Status reports process liveness, not edge readiness. Stop checks PID start-time,
executable and config identity before signaling, so stale/PID-reused records do
not target another process. A stale record requires explicit operator review.
The executable comparison uses its canonical real path, including when checkout
ancestors are symlinks. Controlled child failures close the record descriptor,
settle the child, remove signal handlers and delete only the invocation's exclusive
record; abrupt operator termination can still leave a stale record.
Ctrl-C of the foreground operator also forwards SIGTERM. Stop the tunnel before
stopping the new game via SIGTERM/Ctrl-C; do not use broad `pkill node` or kill the
old 2567 process. Logs can contain the public URL and tunnel identifiers; keep
them private and avoid debug logging. No account certificate/login is required.

For a later download, use the exact URL and digest in
`tools/cloudflared-release.json`; fetch official release metadata and compare its
asset digest before granting execute permission. Binary destination must remain
the ignored project-local `tools/bin`, not a system install.

## Limits and later acceptance

QuickTunnel has changing random hostnames, no uptime/SLA, 200 in-flight-request
limit, and no SSE. Machine/network/foreground processes must stay on. Restart
ends in-memory rooms; changing hostname invalidates existing invite URLs.
Cloudflare terminates public TLS; app HTTP/WS travels locally over the protected
socket. Nothing here claims public-edge capacity or a completed internet test.

After activation: verify HTTPS index, WSS 101, Solo and two independent Co-op
visitors, legitimate movement/pickup, disconnect/reconnect preserving authority,
and seven rapid creation attempts with spoofed forwarding headers. Verify an
independent visitor retains its budget; use no production debug route. Record
actual results and stop the tunnel if origin identity is missing/incorrect.
