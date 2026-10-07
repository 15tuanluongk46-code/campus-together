# Campus Together — approved product specification

## Product and delivery
Deliver one complete locally runnable browser game, frontend and backend together, not an intermediate demo. Private co-op rooms for 2–4 PC/laptop players prepare a campus festival in a 10–15 minute round. User approved the full scope and build on 2026-10-04. Phases are internal milestones only. Public hosting is a separate externally authorized action.
Target machine: i7-12700, 32 GB RAM, RTX 3060 12 GB. Aim for 1080p/60 FPS; report measured evidence and background GPU load instead of promising results. No mobile controls required.

## Art and experience
Original stylized third-person cartoon campus, inspired by the reference's school/neighborhood feel. Cohesive warm cream architecture, terracotta roof accents, teal foliage/shadows, marigold festival accents. Courtyard, short street, storage, corridor, classroom and festival stage are all explorable and connected. Readable human characters with four identifiable variants (number/icon plus color), backpacks and idle/walk/run/pickup/drop/carry-idle/carry-walk/interact/celebrate animation. Final output must include finished art, lighting, sound, UI and gameplay. No graybox final delivery.
Vietnamese typography and polished start/create/join/lobby/ready/settings/HUD/context interaction/pings/pause/network state/results/replay. Clear onboarding, objectives, room code/link, teammate indicators and actionable errors. Smooth third-person obstacle-avoiding camera. Contextual highlight, ownership-confirmed feedback, footsteps, pickup/delivery/UI sounds and licensed/original ambient music. Volume, quality, mouse sensitivity settings persisted locally. Pointer lock on explicit play action, Esc releases, blur clears input.

## Controls
WASD movement; mouse camera; Shift sprint; E context pickup/install/deliver/hold interaction; G safe drop; Q ping; Esc pause/menu. Walking 3.5 m/s, sprint 5.5 m/s, crate carrying 3 m/s without sprint. Item reach 1.6 m plus line of sight. One held item. Held item aligns to hand/body carry sockets, never free rigid-body jitter.

## Complete game loop
Create private room or join code/link as guest, 2–4 ready players, leader starts, all play, results, replay with ready lobby reset. No new joins mid-round; reconnects allowed. Leader departure transfers leadership. Three phases:
1. Deliver two decoration crates, cable and fuse from storage/campus to marked festival sockets. A teammate can hold a shortcut gate open; an alternate longer route always exists.
2. A classroom clue specifies the order of three symbols/modules at the power panel. One teammate reads the clue and communicates (local typed preset/pings are sufficient); others collect/install matching modules. Wrong socket/order is rejected with retryable feedback and no item loss.
3. Two different players hold two stage stations continuously for 3 seconds to launch the festival. Extra players can complete optional banner/lantern deliveries. All mandatory work is solvable with two. Optional work never blocks finish; scores reward actual completion once, not pickup/drop farming.
Three validated item layouts per round and clue-order variants. Completed progress is stable on departure. Timer ends round clearly if expired. One player left gets a finite 60-second grace period, then ends if no reconnect. Server restart ends session clearly, no persistent account/database in this release.

## Authoritative state and items
Server owns movement bounds/collision, room phase, timers, item ownership, sockets, mission completion and score. Client sends input/intent, never trusted positions or completion. Shared content/collider definitions. Fixed simulation initially 30 Hz; snapshots 10–20 Hz; client local prediction/reconciliation and remote interpolation. Clamp input, sequence/ack, expire stale movement input, rate-limit intents, validate every message.
Item lifecycle WORLD -> CARRIED -> WORLD or INSTALLED/DELIVERED. One holder/item and one item/player. Requests include requestId, itemId, expectedRevision as appropriate. Derive player identity from socket. Validate phase, state, revision, distance, line of sight, free hand, correct target. Atomic synchronous mutation without awaits between validation/write. Deduplicate requests; contested pickup exactly one winner. All ownership mutations increment revision. Delivery/installation scored once.
Server validates safe drop surface/clearance; rejected drop keeps item. Out-of-bounds items recover with same id to a safe location. Drop held item 3 seconds after disconnection, reserve reconnect seat 30 seconds. Reconnect receives current snapshot and cannot resurrect old ownership. Voluntary leave drops immediately.

## Technology and module boundaries
TypeScript, npm workspaces, Three.js + Vite client, Node + Colyseus room server, Rapier 3D shared collision/movement, Blender-produced GLB source assets. HTML/CSS UI. Separate transport/session, domain items/missions, shared simulation/content/protocol and presentation. Root scripts must run dev client/server, unit/integration tests, typecheck, build and end-to-end tests. Use current compatible dependency versions and lockfile.
`packages/shared` owns protocol types, campus layout, colliders, interactable placements and movement constants. `apps/server` owns room and authoritative domain. `apps/client` owns rendering/animation/input/UI/audio/network adapter. `assets/source` owns editable Blender asset source; `apps/client/public/assets` exported GLBs and audio/provenance.

## Acceptance evidence
- Unit/integration: concurrent pickup, idempotency, stale revision, out-of-range/through-wall rejection, full hands, wrong socket/order, exactly-once delivery, safe drop, disconnect and reconnect, room isolation, phase transitions and replay.
- Real WebSocket clients: two/four guest sessions, leader departure, disconnect/reconnect, two rooms, complete round via legitimate movement/interaction (no production cheats).
- Browser E2E: start/create/join/ready/play/context input/HUD/settings/results; multiple isolated contexts. Input and camera behavior; no browser errors. Capture actual lobby/campus/interior/carry/festival screenshots.
- Network impairment: delay/jitter/disconnect on actual WebSocket path, reconcile without dupes. Distinguish automated bots from real human playtesting.
- Performance: one rendered client with additional headless/network clients, FPS/frame time, draw calls/triangles, payload size, repeated-session resource checks. Report limitations if GPU access differs from user's normal browser.
- README setup/run/build/deploy, env example, original asset/audio licenses, architecture and test report. Do not claim internet deployment, four physical machines or subjective fun have been verified if not.
