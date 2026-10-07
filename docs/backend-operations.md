# Backend admission and readiness

Binding scope: [hardening spec](backend-hardening-spec.md). No wire version bump,
sequence/dedup change, scene/UI redesign, or production debug route.

## Configuration

The entrypoint and `createCampusServer` validate configuration before constructing
the server. Values must be positive safe integers, decimal digit strings in env;
empty, fractional, negative, nonnumeric and unsafe values fail startup.

| Variable | Default | Meaning |
|---|---:|---|
| `CAMPUS_MAX_ROOMS` | 32 | Initializing plus registered/live rooms per process |
| `CAMPUS_CREATE_BURST` | 6 | Creation-request token bucket capacity per peer IP |
| `CAMPUS_CREATE_REFILL_MS` | 10000 | Time to refill one token |
| `CAMPUS_MAX_IPS` | 4096 | Maximum remembered IP identities |
| `CAMPUS_IP_IDLE_MS` | 600000 | Idle expiry, swept on the next allocating request |

Defaults are conservative pilot settings, not a load/capacity claim. No unbounded
identity eviction or admission bypass: when the table is full, a new identity gets
503; existing identities retain their budget. Rejected requests update that
identity's activity. IPv4-mapped IPv6 and equivalent IPv6 spellings canonicalize.
Valid IPv6 zone suffixes (for example `%eth0` or `%2`) are stripped before address
canonicalization; interfaces do not grant separate identity budgets. Malformed
zones and zones on IPv4 are rejected. Runtime limit objects must contain exactly
the five known keys with finite positive safe integer values.

On TCP, only `IncomingMessage.socket.remoteAddress` identifies a peer:
`CF-Connecting-IP`, `X-Forwarded-For`, `X-Real-IP`, `X-Client-IP`, `Forwarded`
cannot grant new budgets. Behind Caddy/Nginx, clients share the proxy peer's
bucket. The explicit opt-in Cloudflare Unix listener is documented in
[cloudflare.md](cloudflare.md): only its filesystem-protected channel accepts
one edge-supplied `CF-Connecting-IP`. Both listeners strip incoming forwarding
metadata before HTTP/WS framework dispatch. Public TLS/WSS remains proxy-owned.

## Pinned dispatch and ownership

`@colyseus/core 0.18.18` routes `POST /matchmake/:method/:roomName` through its
router **before Express** (`src/Server.ts`, `src/router/index.ts`,
`src/router/default_routes.ts`, `src/matchmaker/controller.ts`). An Express
`app.use` limiter would be bypassed. `Transport.createAuthContext` also prefers
forwarded IP headers, so its `ip` is unsuitable here.

The application installs one outer Node request boundary synchronously in the
`Server.listen` callback, after framework routes bind and before request dispatch.
It uses the actual framework route matcher. Both `create` and `joinOrCreate`
spend one token **before body parsing**, even for malformed JSON/options. A
`joinOrCreate` request is charged even when framework concurrency hands it an
existing reservation. OPTIONS and nonallocating join/reconnect paths do not
spend creation tokens. The pinned HTTP framework routes and normalized aliases
are covered by real requests.

Successfully admitted allocation dispatch establishes a one-use `AsyncLocalStorage`
capability owned by this server. Its active/consumed state is shared by async
descendants: `reserve()` consumes it atomically before any await, and dispatch
`finally` revokes it even if unused or dispatch fails. Retained timers/promises
cannot reuse it or perform a first late allocation. The pinned framework outer
listener does not return its async handler; matched routes therefore use the
exported `toNodeHandler(server.router.handler)` adapter, awaited by the boundary.
`CampusRoom` reserves capacity synchronously before
code allocation/listing/WASM initialization. Nonadmitted framework or internal
creation fails closed, including future routes that weren't explicitly admitted.
The registered class receives this server's owner by constructor closure, never
through client JSON, `onCreate` defaults or mutable process-global policy.

Reservation health and count share the same owner and idempotent release. Init
failure and normal disposal release it exactly once. Until framework registration,
the capability owns an abandoned-initialization cleanup callback. Dispatch finally
awaits disconnect/disposal if recording or registration failed after `onCreate`;
registration clears that callback so successful rooms survive dispatch completion.
Shutdown marks draining
synchronously, refuses allocation, and waits for initialization through framework
registration (the registered handler's `create` event), not just `onCreate`.
Rooms still initializing at drain clean up instead of becoming playable. A
permanently hung initializer can delay shutdown; the owner does not falsely
release resources that are still in use. An operator can apply an external stop
timeout. Framework registration/storage uses the existing local driver; this is
still a single-process deployment, not a distributed reservation service.

429 means the creation bucket is empty; 503 means capacity, identity saturation,
missing trusted allocation context, or draining. Responses contain Vietnamese
retry guidance and numeric SDK `code`; outer admission responses preserve CORS
using the same pinned, typed controller defaults plus **configured**
`getCorsHeaders` policy (not separate Origin reflection), and supply `Retry-After`
seconds. A policy failure omits CORS rather than granting broader access; error
handling does not throw again. Rejected bodies are drained with `req.resume()`.
Capacity errors emitted by the framework carry
503 and retry guidance without a fixed wait promise. Valid joinById/reconnect
remains available while creation is throttled/full; existing phase, capacity,
reserved-seat, name and mode validation still applies.

## Health and simulation failure

- `/health`: unchanged `{ "ok": true, "protocol": 1 }`, liveness only.
- `/ready`: `Cache-Control: no-store`; 200 only for `ready`, otherwise 503.

Example empty response:

```json
{"status":"ready","rooms":0,"capacity":32,"simulation":{"starting":0,"stale":0,"failed":0,"oldestSuccessAgeMs":null}}
```

Status is `starting`, `ready`, `degraded` or `draining`. Public responses include
only aggregate room count/capacity and successful-simulation freshness, no room
IDs, IPs or player names. Empty is healthy. A new room has less than 5000ms startup
grace without a successful tick; at 5000ms it is stale. Once a tick has succeeded,
age **over 2000ms** is stale (exactly 2000ms is still fresh); startup grace cannot
hide a previously ticking room's stall.

Heartbeat is acknowledged only after successful domain simulation and any due
snapshot publish. Tick exceptions are caught and marked failed, further timers
and actions stop, then sockets close with 4002 and framework disposal frees WASM
and the reservation. Failed heartbeats cannot heal before disposal. If disconnect
fails, the stopped room stays counted/failed rather than advertising false health.
After successful disposal, an empty/otherwise healthy server is ready again.
No process-wide unhandled-exception handler is installed to conceal failures.

Readiness cannot answer while the event loop is blocked and is not an asset,
full-round, persistence or capacity benchmark. Frontend/title appearance is unchanged.

## Verification and packaging

```sh
npm run typecheck
npm test
npx vitest run tests/unit/backend-missions.test.ts tests/unit/server-operations.test.ts tests/unit/finish-normalization.test.ts tests/integration/admission.test.ts
npm run package
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome npx tsx tools/package-smoke.ts artifacts/sha256/<SHA>.tar.gz
```

`npm test` includes real network Solo reconnect/full-round, Co-op 2/3/4-player
full-round/reconnect/items/replay, all three Solo layouts in the domain, authority,
invalid messages, expired seats, impairment and immutable packaging regressions.
Fault tests inject failures only from tests, not through runtime endpoints.
Package smoke verifies the archive digest and runtime tree, installs into a fresh
extraction, and exercises same-origin sockets and browser Solo/Co-op. Current
localhost2567 is not replaced by this task. Exact runs, RED/GREEN results and
artifact identity: `.superpowers/sdd/backend-hardening/implementation-report.md`.
