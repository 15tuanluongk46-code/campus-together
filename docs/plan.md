# Campus Together Implementation Plan

> For agentic workers: use subagent-driven-development task-by-task, with independent spec and quality review. No commits without the user's explicit request.

**Goal:** Complete stylized campus web co-op for 2–4 players with polished visuals and authoritative gameplay.
**Architecture:** Shared typed world/protocol and Rapier movement, Colyseus authority, Three.js presentation and DOM UI. Domain logic is testable without renderer; transport integration is verified against real clients.
**Tech Stack:** TypeScript, npm workspaces, Vite, Three.js, Colyseus, Rapier 3D, Vitest, Playwright, Blender GLB.
**Spec:** `docs/spec.md` (binding authority).

## Global Constraints
- One complete delivery; full three-phase round, all map areas, polished art/UI/audio.
- PC/laptop, keyboard/mouse, Vietnamese UI, 2–4 private-room players.
- Server authoritative, no client teleport/debug completion bypass, no duplicate ownership.
- No commits/push/publish/paid service/config changes without explicit authorization.
- Source changes and assets only inside this project; do not disturb the live Blender user's scene.
- Record commands and observed results. Never substitute inspection for executed verification.

### Task 1: Shared simulation and complete authoritative server
**Files:** root package/config scripts; packages/shared/src/{protocol,world,movement,index}.ts; apps/server/src/{index,room,domain}.ts (split further by responsibility); tests/unit and tests/integration; docs/contracts.md.
**Consumes:** docs/spec.md.
**Produces:** documented client APIs/types/content, server endpoints, shared prediction implementation, passing domain and WebSocket tests.
- [ ] Establish npm workspace and strict TypeScript build/test scripts. Choose compatible packages via registry/docs.
- [ ] Write failing behavior tests for movement collision, ownership race/idempotency/revision/reach/LOS and phase progression; run RED.
- [ ] Implement shared campus layout with reachable storage/classroom/stage and a functional gate shortcut/alternate route; export shared movement/collider APIs.
- [ ] Implement complete item/mission/session authority, reconnect/replay/timers/leader handling, message validation and rate limits.
- [ ] Run GREEN unit tests and real WebSocket two/four-client isolation and lifecycle tests.
- [ ] Document exact interfaces and full message/snapshot format for the client; produce report and review.

### Task 2: Original animated assets
**Files:** assets/source/*; apps/client/public/assets/*; docs/art.md; asset manifest.
**Consumes:** shared world scale and docs/spec.md.
**Produces:** Blender source, animated human GLB with required clips and stable carry attachments, reusable stylized trees/props, provenance and export validation.
- [ ] Inspect live Blender/version, preserve user's scene by operating in a separate scene/file.
- [ ] Author coherent original stylized student and backpack rig, four tint identities, required motion clips and grip sockets.
- [ ] Create finished campus props/trees/festival decorations (architecture can be authored procedurally by client using shared layout).
- [ ] Export GLB and validate animation names, meshes, bounds, materials and sockets; inspect visual evidence.
- [ ] Write art/asset integration contract and report; review.

### Task 3: Complete frontend and integrated experience
**Files:** apps/client/{index.html,src/*,public/assets/*}; tests/client; docs/controls.md.
**Consumes:** Task 1 contracts/shared simulation and Task 2 asset manifest.
**Produces:** finished playable game and full UI journey against real server.
- [ ] Create visual direction and cohesive responsive desktop UI; test observable session/HUD state transformations RED then implement.
- [ ] Render shared map with complete architectural/art treatment; load animated characters/props, lights, atmosphere, shadows, signage, stage festival effects.
- [ ] Integrate network snapshots/intents/reconnect, prediction/reconciliation/interpolation, input expiry and obstacle camera.
- [ ] Implement ownership-confirmed pickup/drop/carry animations and context highlight, pings, mission clue/panel/gate/stations.
- [ ] Implement title, join/create/lobby/ready, onboarding, settings, pause/reconnect/results/replay; original synthesized music and spatial/action audio.
- [ ] Run typecheck/build/client tests; capture real UI/map evidence and report; review.

### Task 4: Acceptance, fault tests, performance and packaging
**Files:** tests/e2e/*, tests/integration/*, tools/*, README.md, .env.example, deployment files, docs/verification.md.
**Consumes:** complete implementation.
**Produces:** executed acceptance results, fixes, production build and operational instructions.
- [ ] Add/run legitimate whole-round two/four-client tests; room isolation, race/reconnect/replay/network impairment.
- [ ] Playwright actual rendered UI journey with isolated contexts, screenshots and error collection; verify character carry and all map areas.
- [ ] Measure one-render-client performance, payload, simulation timing and repeated round resource stability; distinguish test environment limitations.
- [ ] Fix discovered defects with regression tests; rerun affected tests and final complete check suite.
- [ ] README runnable local/LAN setup and production hosting procedure; original license manifest; no unrequested external deployment.
- [ ] Independent whole-project review and scoped fixes; final evidence report with remaining limitations.
