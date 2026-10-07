# Campus Together — protocol v1 with approved Solo extension

Authoritative source: `packages/shared/src/protocol.ts`, `world.ts`, `movement.ts`.
The approved `docs/solo-spec.md` extends the original co-op rules. Changes to wire
semantics require updating this document, types, and behavior tests together.
Deploy the shared/server/client build together; a pre-Solo server lacks the mode fields.

## Packages and transport

Node >=22.12, npm workspaces, ESM. Import runtime and types from `@campus/shared`.
Run the root build before using workspace runtime exports. Browser bundlers can
bundle the shared package (Rapier compat embeds WASM; `await CollisionWorld.create()`).

Installed compatible stack: `@colyseus/core 0.18.18`,
`@colyseus/ws-transport 0.18.4`, `@colyseus/sdk 0.18.5`,
`@dimforge/rapier3d-compat 0.21.0`, `zod 4.6.5`.

Default `ws://127.0.0.1:2567`, HTTP matchmaking on the same port.
`HOST=0.0.0.0 PORT=2567 npm start` enables the chosen LAN interface binding.
`GET /health` returns `{ "ok": true, "protocol": 1 }` (process/HTTP liveness only,
not asset/readiness, matchmaking or gameplay acceptance).
`GET /ready` reports aggregate readiness; see [backend operations](backend-operations.md).
All production transport declarations use shared `PROTOCOL_VERSION` (still 1).
Use Colyseus SDK matchmaking; do not implement its binary envelope manually.

```ts
import { Client } from '@colyseus/sdk';
import type { GameSnapshot, Intent, IntentResult, Welcome } from '@campus/shared';
const client = new Client('ws://127.0.0.1:2567');
const room = await client.create('campus', { name: 'An', protocol: 1 });
// Solo: client.create('campus', { name: 'An', protocol: 1, mode: 'solo' })
// Another browser: client.joinById(code.trim().toUpperCase(), { name: 'Bình', protocol: 1 })
room.onMessage('welcome', (welcome: Welcome) => { /* identity + code */ });
room.onMessage('snapshot', (snapshot: GameSnapshot) => { /* replace authoritative view */ });
room.onMessage('result', (result: IntentResult) => { /* match requestId, show Vietnamese message */ });
room.onMessage('sessionEnd', ({ message }) => { /* terminal session UI */ });
room.send('sync', { protocol: 1 }); // re-request after attaching handlers
```

- Room code **is** `room.roomId`: 8 uppercase characters from
  `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, cryptographically generated, unique among live rooms.
  Suggested browser link: `/?room=ABCDEFGH`; frontend parses it and calls `joinById`.
- Rooms are private (not discoverable in room listing); no public quick-match UI.
- Creation options are strictly `{ name, protocol: 1, mode?: 'solo' | 'coop' }`;
  omitted mode defaults to coop. Mode is server-owned, immutable through replay,
  reconnect and departures; no intent can change it. Subsequent join options are
  strictly `{ name, protocol: 1 }`; name is trimmed, 1–24 UTF-16
  units, no control/format characters or angle brackets. Render all names as text.
- Capacity is **1 Solo / 4 co-op**, including reserved reconnect seats. Reconnect
  restores identity rather than acquiring a new seat. No new joins outside lobby.
  Start needs one ready Solo player or two to four co-op players; **every seat**
  must be connected and ready, including reservations. `startEligibility` is shared
  by server and client and supplies blocked-start copy. Only leader starts/replays.
  Solo title creation sends ready then start after the first authoritative snapshot;
  movement waits for the onboarding's explicit play action. Co-op replay returns
  to an unready lobby. Solo replay atomically resets and enters supply with a fresh
  18-minute deadline; no second ready/start transaction is needed.
- The protocol uses **full custom `snapshot` messages**, not Schema state patches.
  Do not rely on `room.onStateChange` or `room.state`.
- Snapshot cadence 15 Hz, nominal simulation 30 Hz, plus immediate phase/lifecycle snapshots.
  `sync` is limited to once/500 ms/player. Payload limit 4096 bytes inbound;
  transport ceiling 120 messages/second/client. Unknown message types are ignored.

## Client messages (exact discriminated types)

`ClientMessages` and `ServerMessages` are exported maps. All fields are required
except fields explicitly marked optional in the TypeScript source. Unknown fields
are rejected. Identity always comes from the socket.

```ts
interface Vec3 { x: number; y: number; z: number }
interface MoveInput { x: number; z: number; sprint: boolean }
interface InputFrame extends MoveInput { seq: number; roundId: number }
// room.send('input', input)

type IntentBase = { requestId: string; roundId: number };
type Intent = IntentBase & (
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'replay' }
  | { type: 'pickup'; itemId: string; expectedRevision: number }
  | { type: 'drop'; itemId: string; expectedRevision: number }
  | { type: 'place'; itemId: string; expectedRevision: number; targetId: string }
  | { type: 'hold'; targetId: 'gate-switch' | 'station-a' | 'station-b'; active: boolean }
  | { type: 'read-clue' }
  | { type: 'ping'; targetId: string; preset: 'here' | 'help' | 'ready' | 'sun' | 'leaf' | 'wave' }
);
// room.send('intent', intent)
// room.send('sync', { protocol: 1 })
```

IDs/request IDs: `[a-zA-Z0-9_-]{1,64}`. Integers: nonnegative, safe JS integers.
Directions: finite `[-1,1]`; diagonal normalized to unit length. No positions,
velocity, timestamps, duration, score, holder ID, phase, completion or player ID
are accepted from the client. Client `roundId` must equal the current snapshot.

Use `crypto.randomUUID()` for **each new intent**, keep the same request ID and
payload when retrying. New UI instances after reconnect must not restart a small
counter at `1`: the server retains dedup history for that player/round. Successful
and failed validated responses are cached; changed payload under the same ID is
`REQUEST_CONFLICT`. Reusing an old round is always `OLD_ROUND`. No eviction during
the round; capped at 16384 records/player, further new requests rate-limited.
Intent bucket: 24 burst, refill 12/s; input bucket: 90 burst, refill 60/s.
Malformed, old-round and conflicting attempts spend this intent budget too, while
retaining their `INVALID` / `OLD_ROUND` / `REQUEST_CONFLICT` classification even
when empty. Only identical cached current-round retries are free, including cached
failures. Rejections never replace the original cached reply or mutate game state.

Review ruling: retain this bounded16384-record defense and **no LRU eviction**.
The18-minute active Solo interval permits at most24+12×1080=**12984** budgeted
new requests, below the cap. This calculation is for the active interval, not an
unbounded lobby wait; pathological long-lived sessions can still hit the defensive
cap. Eviction could let an old same-ID action execute twice and violates the
round-long dedup invariant. A malicious client choosing a maximum sequence can
self-lock its own later input; this is not a cross-player vulnerability. Preserve
the client's monotonic sequence across reconnect; do not reset server/client
sequence at reconnect. Replay/new round is the defined reset boundary.

## Replies and snapshots

```ts
interface IntentResult {
  requestId: string | null; // null for malformed/unassociated messages
  roundId: number;
  ok: boolean;
  code: ErrorCode;
  message: string; // actionable Vietnamese
  clue?: ('sun' | 'leaf' | 'wave')[]; // only successful read-clue reply to reader
}
interface Welcome {
  protocol: 1; playerId: string; roomCode: string; tickRate: 30; snapshotRate: 15;
}
interface SessionEnd { code: 'SERVER_SHUTDOWN'; message: string }
interface PrivateClue { roundId: number; clue: ('sun' | 'leaf' | 'wave')[] }
// room.onMessage('clue', ...): private retained clue after sync/reconnect,
// sent AFTER snapshot, only if this same identity already read the board this round.
```

`ErrorCode`: `OK`, `INVALID`, `NOT_CONNECTED`, `RATE_LIMIT`, `REQUEST_CONFLICT`,
`OLD_ROUND`, `WRONG_PHASE`, `NOT_LEADER`, `NOT_READY`, `FULL`, `UNKNOWN_ITEM`,
`STALE_REVISION`, `NOT_WORLD`, `HANDS_FULL`, `NOT_HOLDER`, `OUT_OF_REACH`, `BLOCKED`,
`WRONG_TARGET`, `WRONG_ORDER`, `OCCUPIED`, `UNSAFE_DROP`.
Matchmaking refusal is an SDK exception (400/403/409, retryable 429/503 admission, or framework room-full/locked
error), not an `IntentResult`; map it to Vietnamese create/join/reconnect guidance.

```ts
type Phase = 'lobby' | 'supply' | 'power' | 'launch' | 'results';
type ItemKind = 'crate' | 'cable' | 'fuse' | 'module' | 'banner' | 'lantern';
interface PlayerSnapshot {
  id: string; name: string; variant: number; connected: boolean; ready: boolean;
  position: Vec3; facing: number; heldItemId: string | null; ackSeq: number;
  moving: boolean; sprinting: boolean; holdTarget: string | null;
}
interface ItemSnapshot {
  id: string; kind: ItemKind; symbol: 'sun' | 'leaf' | 'wave' | null;
  state: 'WORLD' | 'CARRIED' | 'INSTALLED' | 'DELIVERED';
  position: Vec3; holderId: string | null; targetId: string | null; revision: number;
}
interface TargetSnapshot { id: string; itemId: string | null }
interface PingSnapshot {
  id: number; playerId: string; targetId: string;
  preset: 'here' | 'help' | 'ready' | 'sun' | 'leaf' | 'wave'; expiresAt: number;
}
interface GameSnapshot {
  mode: 'solo' | 'coop'; durationMs: number;
  protocol: 1; worldVersion: string; roomCode: string;
  tick: number; serverTimeMs: number; roundId: number; layout: number; phase: Phase;
  leaderId: string | null; remainingMs: number; soloRemainingMs: number | null;
  score: number; powerStep: number; launchProgressMs: number; gateOpen: boolean;
  stationAComplete: boolean; gateChargeMs: number; gateRemainingMs: number;
  result: 'success' | 'timeout' | 'alone' | null;
  players: PlayerSnapshot[]; items: ItemSnapshot[]; targets: TargetSnapshot[]; pings: PingSnapshot[];
}
```

`serverTimeMs` is monotonic elapsed room time, not UTC; `tick` is monotonic over
replays. `roundId` starts at 1. `ackSeq` starts at -1 and resets at replay.
Variant is unique 0–3 among room members and stable through reconnect/replay;
use color **and** number/icon. Room arrays are complete, removal means removal.
Clue order is **not** included in public snapshots; only proximity-validated reader
gets the private reply. A server-private per-player discovery flag allows that reader
to recover the clue on sync/reconnect via `clue`; replay clears it. `layout` exposes
placement variant, not clue variant. UI retains the clue card throughout power.
`soloRemainingMs` is the legacy **co-op alone-grace** field, not the Solo round timer;
it is always null in Solo. `remainingMs`/`durationMs` drive the round clock/results.
`stationAComplete` is the Solo latch (false for co-op); `launchProgressMs` is the
current Solo station charge, or the co-op simultaneous charge. Solo A completion
sets its latch and resets the charge for B. `gateChargeMs`/`gateRemainingMs` are
server-owned Solo charge/countdown (zero in co-op); `gateOpen` can outlast the
countdown solely due to the doorway interlock.

## Movement, prediction, presentation

Coordinates: metres, +Y up; +X east, +Z south; feet position at y=0.
Facing in radians: `atan2(input.x,input.z)`; 0 faces +Z, +π/2 faces +X.
Shared capsule radius .32 m, half segment .5 m, controller skin .015 m;
visual human height ~1.65 m. CollisionWorld has no avatar–avatar collisions,
so teammates cannot trap each other in doorways. No jump/stairs in this map.
All walkable areas, storage/classroom/corridor/stage approach are flat y=0.
Visual stage platform must not become a new unshared obstacle: use a flat stage
surface/decal here, or change shared content/movement and revalidate before adding elevation.

```ts
const collision = await CollisionWorld.create();
collision.setGate(snapshot.gateOpen);
const next = collision.move(feet, { x, z, sprint }, carryingCrate); // exactly 1/30 s
collision.hasLineOfSight(feet, target.position);
collision.isFree(feet, radius); // navigation/clearance query
collision.dispose(); // free WASM world when leaving
```

Speeds: walk 3.5, sprint 5.5, crate carry 3 m/s with sprint disabled. Other small
items retain normal movement speed. Movement uses latest valid intent at each
fixed movement step; no speed-up from message flood or delayed client timestamps.
Expires after 250 ms without valid input. Transport timers use actual elapsed server
time even if the event loop stalls; a stalled tick never causes a giant movement step.
Hold timers never credit more than one simulation step per tick.

Frontend: convert camera-relative WASD into **world-space x/z**, sample/send 30 Hz.
Maintain monotonically increasing sequence per round (preserve last-sent counter
across reconnect; otherwise start above last sent/ack). Send zero input on blur,
Esc, pause, or input release. Pause releases the current hold immediately and ceases
periodic input; resume keeps increasing sequence/prediction. Movement in lobby/results
is ignored. Symbol keys only operate in power with active, online, unpaused input.

`reconcile(world, authoritativeFeet, ackSeq, pendingSteps)` replays local predicted
fixed steps newer than last-applied input, with each step's carry speed mode.
Because the server holds the latest direction until refreshed/expired, `ackSeq`
acknowledges the **input sample**, not a client timestamp or number of future ticks.
Use each new predicted tick's increasing input sequence, retain only the bounded
unacknowledged window, and reset it on reconnect/replay. Under jitter, periodic full
authoritative correction remains necessary (not a deterministic lockstep promise).
Interpolate remote snapshots ~100 ms behind; use `moving`, `sprinting`,
`heldItemId` and successful replies for animations. Hold item art in carry sockets;
carried `position` follows owner feet and is not a free physics body. Do not render
a second world mesh for a carried item. Revisions change on ownership lifecycle,
not every tick of carried position.

## World/renderer contract

`WORLD_VERSION='campus-1'`, bounds x=[-24,24], z=[-18,18].
Exports: `COLLIDERS`, `BUILDINGS`, `AREAS`, `PATHS`, `TARGETS`, `ITEM_LAYOUTS`,
`SPAWNS`, `RECOVERY_POINTS`, `PALETTE`, `CLUE_ORDERS`.

`BoxCollider`: `{ id, center: Vec3, half: Vec3, role: 'wall'|'boundary'|'planter'|'gate' }`.
The renderer must use the **same center/half extents** for solid architecture and
interactive gate. It may dress surfaces/roofs/vegetation without adding colliding
obstacles or narrowing doorways. `BUILDINGS` supplies footprint, height, door
centers/widths/axis. Roofs must support indoor camera readability/cutaway later.

Composition: warm cream storage west (x=-20..-12,z=-5..5); classroom northwest
(x=-9..1,z=-15..-8); attached covered corridor east to x=8, open eastern exit;
festival stage east; courtyard and two low teal planters; southern festival street
forms the long route. Cream/terracotta/teal/marigold palette exported for later art.
Storage east doorway is 3 m wide; classroom south doorway 3 m, corridor connection
2 m. Props on target points should remain visually small/nonblocking.

The central divider blocks x=0 from z=-8..8. A 3 m gate at z=0 opens while a
co-op teammate holds the switch at (-1.3,2.7). Solo requires empty hands and a
continuous 1000ms hold, then opens for 15000ms of server time. Early release,
invalid reach/LOS, pickup, stale heartbeat or disconnect clears partial charge.
After activation, held heartbeats cannot retrigger; explicit release/repress is
required (disconnect resets input and also rearms). From (-3,0) to (3,0), closed route is
>20 m versus 6 m direct. Alternate south street and classroom/corridor route always
remain open. Gate closure waits while a player intersects its closing zone.
Items cannot be dropped into that zone even while the gate is open.

Every item placement in all three layouts and every target has an executed
Rapier walking-route test from **each of four spawns** with **closed gate**, ending within 1.6 m
and unobstructed line of sight. This is topology/collision evidence, not rendered
art, camera, subjective attractiveness or human playtest evidence.

## Missions, interactions and score

All reach is ground-position Euclidean distance <=1.6 m and Rapier LOS at interaction
height .9 m. No player collision blocks LOS. Call `place`, not `pickup`, for occupied
hand contextual E at a socket. Pickups/placements are synchronous atomic mutations.

| Phase | Mandatory work | Score |
|---|---|---|
| supply | `crate-a` / `crate-b` to `decor-a` / `decor-b` (either crate fits either socket); `cable` → `cable-socket`; `fuse` → `fuse-socket` | 100 per delivery/install |
| power | Reader uses `read-clue` near `clue-board`; order uses `sun`,`leaf`,`wave`. Deliver matching `module-*` into `power-0`, `power-1`, `power-2` in order | 100 per module |
| launch | Two distinct players continuously hold `station-a` and `station-b` for 3000 ms | 500 on success |
| launch (Solo) | Hold `station-a` for 3000 ms to latch, then `station-b` for 3000 ms | 500 on success |
| any active phase | `banner` → `banner-socket`; `lantern` → `lantern-socket` | 50 each |

Mandatory maximum 1200; both optional gives 1300. Pickup/drop gives no score.
Wrong phase/type/slot/order/revision/reach rejects **without losing item**.
Items carry one owner; players one item; all ownership changes increment revision.
Same valid request gets same reply; reissued placement can't increase score twice.
Modules can only be picked up during power. Installed/delivered items are final.
Three placement variants and three independent clue variants selected server-side
on create; replay cycles each variant, clears ready/ownership/score/progress.
Optional work never blocks launch. Mission completion persists through departures.

Hold: send `{active:true}` every ~100–150 ms while E remains down. Release with
`active:false`. Expiry 400 ms, disconnection, leaving reach/LOS, item pickup or wrong
phase clears hold. A player can hold only one station; hands must be empty.
Co-op selects a stable pair of two distinct contributing holders, one per station.
The pair persists while both remain valid, even if an earlier-listed player begins
holding redundantly. A redundant holder's release, expiry, disconnect, pickup or
loss of reach/LOS does not reset that pair's progress. A contributing interruption
resets immediately; selecting a replacement starts a fresh three-second interval.
Pair references clear on finish/replay/disposal. Solo B before A never progresses. Solo A completion survives reconnect;
partial A/B charge resets on release, target change, pickup, disconnect, invalid
reach/LOS/phase or heartbeat expiry. Releases and pickup reset immediately, so
release/repress or pickup/drop within one tick cannot bridge an interruption.
Empty hands and phase/reach rules apply equally. Gate switch also needs heartbeat. Ping has 750 ms/player cooldown,
4-second lifetime, at most 8 recent room pings; use symbol presets for clue sharing.
Ping target IDs may name a shared target, an item, or a current room player. The
last case supports Q “here” away from interactables; unknown/other-room IDs reject.

Safe G drop uses .85 m forward from server-facing direction, validates flat ground,
shared obstacle clearance, LOS, and other world items. Unsafe drop keeps ownership.
Forced disconnect/leave drop falls back to valid nearby floor/recovery point.
Out-of-bounds world items keep ID, recover to a safe point, and increment revision.
Recovery searches all authored clusters then a bounded campus grid, validating
both collision and world-item clearance. If no point exists it throws explicitly,
never returns `{}` or knowingly overlaps another item. With nine production items
and the fixed map, the executed topology provides ample safe recovery locations.

## Session and timers

- Round time **18 minutes Solo / 12 minutes co-op**; remaining time and score freeze
  in results. The clock continues while paused or disconnected.
- Every result path clears gate openness, countdown, charge and rearm bookkeeping;
  results never advertise a running gate timer.
- Co-op: fewer than two connected players starts 60-second grace. A reconnect restoring
  two cancels it; expiry gives `result:'alone'`. Round deadline gives `timeout`.
- Solo never ends for having one connected player; second joins are refused even
  in lobby or a reserved reconnect seat. Explicit leave removes the seat and the
  transport disposes an empty room normally. Co-op departures never change mode.
- Non-consented network loss clears movement/holds and immediately transfers leader
  to first connected member. Drops held item after 3000 ms; seat reserved 30 seconds.
- `room.leave()` is voluntary: immediate drop/removal, no reconnect reservation.
- SDK close code 4000 is consented; tests use 4010 to exercise abrupt-disconnect
  lifecycle (1001 cannot be supplied by browser-style WebSocket.close()).
- Reconnect using current private `room.reconnectionToken`, via SDK auto-reconnect
  or `client.reconnect(token)`; keep token private, never put it in invite links.
  On manual reconnect attach listeners to returned room, then send `sync`.
  Before 3 s held item remains; after 3 s snapshot shows the dropped item/current
  owner. Old requests/revisions never resurrect ownership. Reconnected former leader
   does not displace current leader. No replacement joins during an active round.
- Browser interruption policy: unacknowledged actions are not automatically replayed.
  After the authoritative reconnect snapshot, show explicit Vietnamese feedback to
  check current state and act again if needed. Holds/input always stop; late replies
  to cleared requests cannot trigger action feedback. Recent pings in first/reconnect
  snapshots establish a silent watermark; only later new pings produce sound.
- After 30 s reservation expiry, token is invalid; show rejoin/new-room guidance.
- Graceful shutdown sends `sessionEnd`, closes sockets and disposes rooms/WASM.
  Process crash cannot send that message: after finite SDK retries/token failure,
  frontend must show session-ended UI and offer new room, not retry forever.
- No persistence/auth accounts/database; restart loses all rooms. No production
  teleport, force-finish, debug scenario or timer-override routes/messages exist.

The gate interlock includes disconnected reserved avatars until they reconnect,
leave or their 30-second reservation expires. Closing onto a reserved avatar is
unsafe; temporarily keeping the shortcut open is intentional and bounded.
Transport lock/unlock listing writes are serialized; domain phase checks remain
the authoritative join gate during asynchronous listing changes.

## Task 3 integration note (wire semantics unchanged)

`npm run dev` starts Vite 5173 and server 2567 together. Vite proxies the unchanged
`/matchmake` and `/<processId>/<roomCode>` WebSocket routes. Client uses its own
origin by default, or build-time `VITE_SERVER_URL` (http/https/ws/wss).
`npm run build && npm start` serves `apps/client/dist` through Express on the
existing server origin. This adds static GET delivery only; no room/domain/input
contract changed. `/health` and SDK routes retain their Task 1 behavior.

Task 3 implements rendering, animation, camera, prediction/interpolation, full UI,
input, audio and lifecycle, and includes executed browser whole-round/reconnect
tests. See `.superpowers/sdd/campus/task-3-report.md`. Task 4 still owns wider
acceptance, hardware GPU profiling and human visual/audio/playtest review.

## Solo UI and verification update

Title actions: **Chơi một mình**, **Tạo phòng cùng bạn**, **Tham gia phòng**.
Asset completion and settings close preserve editable name/room fields. Modal
background controls remain inert/focus-contained; noninteractive toast and live
network-announcement regions remain outside inert. Results label mode and use its
duration. Solo lobby has one seat and no misleading invite action.
Tests run on separate loopback ports (browser server2667/client5273 by default;
unit/socket servers use OS-assigned ports). See `.superpowers/sdd/solo/implementation-report.md`
for executed acceptance, artifact paths and limitations. The later approved
backend-hardening patch adds admission/readiness; it does not add security headers.

## Play-flow extension — 2026-10-06

Replay is one synchronous authority mutation. Its success reply carries the new
round ID; subsequent requests using the old round (including the same replay ID)
return `OLD_ROUND`, never restart/reset the new timer. A new replay during active
play returns `WRONG_PHASE`. Current-round dedup/sequence rules are unchanged;
old requests cannot cross reset. Client pending actions clear at the boundary
together with prediction, private clue, HUD and first-use tips.

Board reads now require empty hands. Gate/clue/station eligibility comes from
shared `interactionEligibility`; full hands is `HANDS_FULL` with G-drop guidance.
Solo B before A is `WRONG_ORDER` with A guidance; completed A is `OCCUPIED` with
B guidance. Completion clears its hold while retaining the latch. Releases remain
permitted. Client contexts are `actionable | blocked | completed`; the latter two
have no intent and cannot emit E/hold. Symbol pings are server-rejected outside
power (`WRONG_PHASE`); other ping/reach/LOS/hidden-order checks remain unchanged.

- Room-code Enter always joins; Enter in the name field joins/validates when the
  room field is nonempty (including manually typed code without an invite). Invite
  Enter in the name field also joins. Explicit
  Solo/Create buttons retain their own meaning. Invalid entry preserves drafts;
  failed matchmaking offers editing/retry. UI and Session block overlapping connects.
- Activation owns a generation/single in-flight gesture. Pointer lock and audio
  start inside the gesture; audio failure is nonfatal with separate guidance.
  Pause/leave/reconnect/round/pagehide invalidate old effects. Physical pointer
  requests are serialized; event-based grant/error is supported. Audio graph setup
  rolls back partial initialization; disposed audio cannot resurrect itself.
  A rapid resume while the cancelled physical request is pending gives neutral
  busy guidance, not a pointer-denial error. The4s UI timeout does not cancel the
  browser request: ownership remains quarantined until actual grant/error. Late
  grants are released without resuming; only a new gesture after settlement may
  request again. If the browser never settles, guidance explains reload ends the
  current session; there is no unsafe overlapping request or implicit reload-resume.
- Active leave opens focus-contained Stay/Leave confirmation (Escape=Stay).
  Stay returns to pause without leave/inventory mutation; lobby/results leave
  immediately. Pagehide disposes without confirmation. No reload-resume is added;
  the authoritative clock continues through all menus/onboarding.
  Reconnecting preserves the leave confirmation; terminal **ended** explicitly
  supersedes it, clears leaving/settings flags and offers an immediately usable
  exit. Escape cannot resurrect a confirmation or pause menu for an ended session.
- Held destinations highlight matching unfinished phase/current slots, never
  guessing undiscovered module symbols. Completed work is marked separately.
  Minimap legend includes own-avatar facing, not camera yaw. Tips are bounded,
  noninteractive and once per round. Symbols are nonclickable keyboard badges.
- Task 1 does not activate localhost2567. Report:
  `.superpowers/sdd/play-flow/implementation-report.md`.
