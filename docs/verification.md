# Play-flow Task 1 verification — 2026-10-06

## Consolidated independent-review fixes

Latest candidate/report: `.superpowers/sdd/play-flow/fix-report.md`. Name Enter
honors manually typed room code, cancelled physical pointer requests give neutral
busy feedback and retain serialization even after UI timeout, terminal network
end supersedes leave confirmation. Co-op replay means an unready ready-up lobby.
Affected verification:65/65 Vitest,15/15 browser tests,typecheck/build PASS; new
regressions first failed4/4 then passed. No repeated GPU diagnostic or new60FPS
claim. Fresh immutable archive identity and extraction smoke are in the fix report.
Live2567 is unchanged.

## Original Task 1 evidence

Report hiện hành: `.superpowers/sdd/play-flow/implementation-report.md`.
Task1 chưa activate runtime2567. Các mục Solo bên dưới là lịch sử.

- Full Vitest cuối: **22files/111tests PASS**,481.50s; cả3layout Solo, optional1300,
  co-op2/4socket rounds, reconnect/revision/sequence, replay stale/dedup, shared
  blocked reasons, activation/audio lifetime.
- Full browser đầu **27/30 PASS**. Failures giữ evidence: software WebGL hold/CDP
  timing, navigator dừng gần bảng gợi ý hơn vật, bốn context1080p timeout. Helper
  cuối đi sát đích; pause test dùng browser event-loop tránh cộng delay CDP vào hold.
- Affected browser cuối **14/14 PASS**,10.7min, thêm regression Esc thường, full
  Solo+co-op, blocked/completed không gửi hold, hủy leave giữ đồ, focus/race/failure.
  Kết hợp full run bao phủ31ca hiện hành; four contexts chỉ xác nhận fallback
  chức năng **1100×720/low**,1/1 PASS. Không coi đó là four-renderer1080p/high PASS.
- Headless NVIDIA1080p,1renderer+3sockets: high **5.40FPS**,p95 **216.6ms**;
  low **5.78FPS**,p95 **200.1ms**. SwiftShader high **2.09FPS**,low **2.51FPS**.
  GPU đang có tải khác (~73%,11537MiB lúc kiểm tra), không dừng ứng dụng hoặc sửa
  compositor/profile. Hardware stderr có lỗi framebuffer driver; không dùng số
  đo này chứng minh hình ảnh đúng/60FPS.
- Walkthrough riêng rendered UI/text+keyboard, không snapshot/tọa độ/helper:
  title→onboarding→nhặt/đặt/tips→Esc→Stay/Leave. Image input không hỗ trợ trong
  phiên; screenshot resize giao controller. Không tuyên bố nghiệm thu hình ảnh,
  nghe âm thanh hoặc human fun. Full rounds nằm ở regression có helper, tách biệt.
- Build/typecheck,production/startup,archive/hash/fresh smoke ghi chính xác trong
  report. Warning Three/Rapier>500kB vẫn có; dự án không cấu hình linter.
- Đo bổ sung bản production khi **di chuyển bằng phím thường**,1920×1080,1renderer
  +3sockets,hai cửa sổ15s: NVIDIA high **21.87FPS**,low **21.39FPS**,p95 **66.7ms**
  cả hai; GL error0,console/page errors rỗng. GPU60–92%,VRAM7578–8116MiB. Tải hệ
  thống đã đổi tự nhiên so với mẫu trước; không dừng ứng dụng. Đây vẫn không đạt
  stable60FPS và không phải nghiệm thu physical-display/human.

---

# Solo extension verification — 2026-10-05 (lịch sử)

## Consolidated packaging/lifecycle fix — 2026-10-06

Current package workflow and activation instructions supersede the historical
build/restore procedure below. See `.superpowers/sdd/solo/fix-report.md` for fresh
commands/results/checksum. Packaging always performs a clean source staging build;
current live checkout dist is neither consumed nor modified. SHA-addressed archive
retention and extracted-runtime tree verification prevent the stale-client pairing
trap. Historical preservation metadata now explicitly distinguishes a lost original
archive from the current integrity-sealed extracted client tree.

## Current Solo build (supersedes status below)

**Functional automated verification passes; stable1080p60 and human visual/audio/
temporal/fun acceptance remain incomplete.** Details and exact commands:
`.superpowers/sdd/solo/implementation-report.md`.

- `npm run typecheck` and `npm run build`: PASS. Existing Three/Rapier >500kB
  warning remains; no linter is configured.
- Full Vitest: **17 files /92 tests PASS**,427.82s, including all3 Solo layouts via
  legitimate input/action, both optional objectives/1300/replay, real Solo socket
  reconnect/item/A latch/private clue, real co-op2/4 full rounds and isolation.
- Browser: full run **22/23 PASS**; one failure was a test navigator retaining a
  route through the now-closed timed gate. Replan-on-gate-change fixed that helper.
  Final affected run **4/4 PASS** (co-op full round +3 Solo/audit tests), covering
  **24 distinct current E2E** together with full run. Solo fully keyboard-controlled
  round included reconnect during power and after A latch,1300/results/replay.
- Built production same-origin test **1/1 PASS**; invalid-endpoint startup **1/1 PASS**.
- Runtime archive/checksum and clean-extraction smoke are recorded in
  `artifacts/package-smoke.json`, adjacent `.sha256`, and the Solo report.
- Browser suites now own separate loopback2667/5273; old user server2567 retained.
  No commits, subagents, hosting or user configuration changes.

Evidence: `.superpowers/sdd/solo/{vitest-final.json,full-browser,full-browser-report,
final-browser,final-browser-report,production-browser,startup-browser}`. Initial
software-browser whole Solo round also passed under `browser-artifacts/`.

Fresh NVIDIA headless1080p diagnostic (1 rendered +3 sockets): high **25.80FPS**,
low **26.40FPS**, both p95 **66.7ms**; four rendered contexts **4.82–5.73FPS** each.
These are bounded test-environment observations, not stable60FPS acceptance or
four physical machines. Desktop session was unknown in this sample. Source cannot
prove visual or temporal quality; this agent's image reader reported unsupported
input, so saved screenshots have no new subjective visual verdict.

---

# Historical consolidated final fixes, 2026-10-05

## Previous verification (before Solo)

**Functional fixes verified. Stable1080p60 and human audio/temporal/fun acceptance
remain incomplete.** Final report: `.superpowers/sdd/campus/final-fix-report.md`.

| Executed command | Fresh result |
|---|---|
| `npm run typecheck` | PASS shared/server/client/tests, including final sampler changes |
| `npm test -- --reporter=default --reporter=json --outputFile=.superpowers/sdd/campus/final-fix-vitest.json` | PASS build +15files/**72tests**,288.17s; unit/client/integration/performance; actual2/4-client full rounds and30/60s expiry |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/sss/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome CAMPUS_HARDWARE=1 CAMPUS_EVIDENCE_DIR=.superpowers/sdd/campus/final-fix-browser CAMPUS_REPORT_DIR=.superpowers/sdd/campus/final-fix-browser-report npm run test:e2e` | PASS **20 headless E2E**,7.6min |
| Same browser/hardware env, evidence `final-fix-sampler`, report `final-fix-sampler-report`: `npx playwright test tests/e2e/resources.spec.ts tests/e2e/art.spec.ts` | PASS4tests,23.1s after final fresh-sampler addition; **21 distinct current E2E covered** by full suite + affected rerun |
| Same browser env: `npm run test:e2e:production` | PASS build +1production same-origin browser test |
| Same browser/hardware env: `npm run test:e2e:startup` | PASS1invalid-endpoint startup test |
| `npx tsc --noEmit --target es2022 --module nodenext --moduleResolution nodenext --strict --skipLibCheck --esModuleInterop tools/load-worker.ts tools/load-benchmark.ts tools/runtime-smoke.ts tools/package-smoke.ts` | PASS |
| `npm audit --omit=dev` | PASS0vulnerabilities |
| `npm run package && npx tsx tools/package-smoke.ts` | PASS rebuilt archive, fresh extraction +npm ci102packages/0vulnerabilities, health/static/two clients/start/movement/reconnect |

No linter configured. Existing Three/Rapier >500kB warning retained. Expected
negative-auth/expiry/latency/reconnect logs are not test failures. No public hosting,
commits, subagents, system/profile changes or user-GPU-process termination.

### Final fixes / evidence

- Stale/conflicting attempts now consume intent budget; identical current-round
  cached retries remain free. Exact budget/refill/state invariants RED→GREEN.
- Unacked actions are not silently retried. After reconnect snapshot, explicit
  Vietnamese interruption feedback asks the player to check state before acting.
  Holds stop; stale replies cannot trigger action feedback. Initial/reconnect ping
  history establishes a silent watermark. Real socket/browser RED→GREEN coverage.
- Join whitespace validation was already correct: now protected by browser test.
  Duplicate asset cache assignment removed.
- Four-context movement/isolation is an independent test, never downstream of a
  resource verdict. Fresh WebGL allocation Sets track repeated/null deletion and
  context loss; frame waits and GC precede resource readback. Renderer.info is
  freshly accessed for each art audit sample.
- Historical11→12 did not record program identities; earlier explanation blaming
  item-layout materials is withdrawn. New raw GLSL reproduction shows a low-quality
  double-sided `MeshStandardMaterial` variant without `USE_SHADOWMAP`. Deterministic
  warmup compiles all cached meshes under both shadow states; all3layouts then
  reuse the same programs. Baseline +9session cycles equal **827buffers/108textures/
  19programs** exactly, program IDs unchanged, no context losses. No relaxed tolerance.
- Highlight already had scene ownership. Teardown now idempotent; actual render
  regression proves highlight geometry/material, actor bone textures, instance
  buffers and shadow target are released once. Final context loss frees remaining
  renderer internals; fresh counters are0/0/0. This is bounded GPU lifetime evidence,
  not a long JS-heap leak certification.
- Performance gate no longer rejects a genuine58+FPS window solely because its
  end timer fired after16s. It checks actual integer callbacks/elapsed time,
  finite >=14s window, finite positive p95<=20ms,1080p/hardware and every baseline.
  Short/invalid/bursty/software/inconsistent samples still fail.

Raw evidence: `final-fix-browser/{resources-*,ownership-*,acceptance-*,feedback-*}`,
`final-fix-sampler/`, `final-fix-vitest.json`, HTML `final-fix-browser-report/index.html`.
RED and initial harness failures are retained/documented in the final report.

### Current performance is a separate adverse diagnostic

`XDG_SESSION_ID=232 PERF_PRODUCTION=1 npx tsx tests/performance/run.ts final-fix-headed normal`:
completed with no browser errors, but **28.98FPS /p9583.4ms**,435callbacks/15008ms,
high/antialias/1920×1080/NVIDIA OpenGL4.5. Desktop naturally changed unlocked→locked;
total GPU56–83%. Raw `.superpowers/sdd/campus/performance/final-fix-headed/`.
Full headless E2E diagnostics: high24.19FPS, low23.93FPS, four shared-GPU contexts
5.25–6.13FPS each. These do not meet the target; no four-machine inference.
Prior~60FPS windows remain historical bounded evidence, not stable acceptance.

Human listening, temporal animation/camera assessment and fun acceptance, long soak,
four-machine LAN/internet and stable1080p60 remain **not completed**.

### Refreshed delivery artifacts

`npm run package` rebuilds runtime tar +SHA; `npx tsx tools/package-smoke.ts` tests
a fresh extraction and dependency install through health/static/two-client start,
movement/reconnect. Current results are in `artifacts/package-smoke.json`; exact
archive SHA in `artifacts/campus-together-0.1.0.tar.gz.sha256` and final-fix report.
Docker's old Task4 test below was not re-executed in this wave.

---

# Historical Task4 and performance investigation

## Verdict

**Functional acceptance passed; performance/subjective acceptance partial.**
Actual two/four-client full rounds, four isolated Chromium contexts, readiness,
movement, room isolation, retries/reconnect, and packaging have been exercised.
Task4 initially did not achieve1080p/60FPS. Follow-up below demonstrates~60FPS
in bounded unchanged-production runs and isolates a remote-desktop presentation
bottleneck; this is not unconditional whole-round acceptance. Human
visual/temporal/audio review remains open. Nothing has been publicly hosted.

Environment: Ubuntu desktop, Node v22.23.2, npm 10.9.8, Chromium 151.0.7922.34
(`/home/sss/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`), RTX 3060
12 GB, NVIDIA 595.91.07. Existing GPU applications were left running. Observed
GPU memory 5.55–5.74 GB and utilization 23–63% around testing; these are point
observations, not a clean idle-system benchmark or per-process utilization trace.

## Reproducible commands / executed results

From project root. Browser commands use
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/sss/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`.
The requested default Playwright revision is absent; no global browser install
or existing user-profile mutation was done.

| Command | Result |
|---|---|
| `npm run typecheck` | PASS: shared/server/client/tests |
| `npm test` | PASS: build + 14 files / 61 tests; subsequent added malformed-budget regression also passed (62 total) |
| `npx vitest run --reporter=default --reporter=json --outputFile=.superpowers/sdd/campus/task4-vitest-final.json` | PASS: final complete 14 files /62 tests,288.15s; includes both actual full rounds and30/60s expiry |
| `npx vitest run tests/unit/authority.test.ts tests/client tests/unit/recovery.test.ts` | PASS: 27 tests after final budget test |
| `CAMPUS_HARDWARE=1 npx playwright test --grep-invert '1080p hardware\|profile actual'` | PASS: 10 browser tests, 4.7 min, full rendered round 1300/replay |
| `CAMPUS_HARDWARE=1 CAMPUS_HEADED=1 npx playwright test tests/e2e/acceptance.spec.ts` | PASS: one + three socket benchmark, four contexts, 8 session disposal cycles, 1.6 min |
| `CAMPUS_HARDWARE=1 npx playwright test tests/e2e/camera.spec.ts` | PASS: final near-overhead camera clearance checks and screenshots |
| `CAMPUS_HARDWARE=1 npm run test:e2e:startup` | PASS: invalid build-time server URL gives Vietnamese error |
| `npm run test:e2e:production` | PASS: built same-origin frontend creates/leaves actual room |
| `npx tsx tools/load-benchmark.ts` | PASS: separate server process, 1/5/10 rooms and cleanup |
| `CAMPUS_HARDWARE=1 CAMPUS_HEADED=1 npx playwright test tests/e2e/media.spec.ts` | PASS: WebAudio recording + signal checks, canvas video, 5-second CPU profile |
| `npm audit --omit=dev` | PASS: zero vulnerabilities |
| `docker build -t campus-together:task4 .` | PASS: fresh Node22 multi-stage build, npm ci, production prune |
| `docker run --rm -d --name campus-task4-check -p 127.0.0.1:2587:2567 campus-together:task4` then `npx tsx tools/runtime-smoke.ts http://127.0.0.1:2587` | PASS: health/static/two WS clients/ready/start/movement/reconnect; container stopped afterward |
| `systemd-analyze verify deploy/campus-together.service` | PASS: syntax only; service not installed/enabled |
| `npm run package && npx tsx tools/package-smoke.ts` | PASS: built runtime extracted to fresh folder, npm ci --omit=dev, health/static/two-client start/movement/reconnect |

No configured linter exists. Tools TS additionally checked with `npx tsc --noEmit
--target es2022 --module nodenext --moduleResolution nodenext --strict
--skipLibCheck --esModuleInterop tools/load-worker.ts tools/load-benchmark.ts tools/runtime-smoke.ts`.
The Three/Rapier >500 kB bundle warning remains visible; it is not hidden by raising
the limit. Docker emitted the host's legacy-builder deprecation warning.
Final suite logs include expected invalid-token expiry warning, intentional
Colyseus latency warnings, and two4002 closes from negative auth tests; no failed
assertions. Final browser impairment rerun has an empty warning list after the
deprecated Three shadow enum was removed.

## Defect reproductions and fixes

- Browser focus escaped settings to background leave button. Added inert
  background, document-level focus containment, filtered Tab cycle and opener
  restoration when the DOM has been replaced. Tests cover settings → remote start,
  pause/settings → results, replay, loading completion, pointer lock and teardown.
- Camera measured 0.142/0.142/0.201 m from pivot at south wall, storage wall and
  classroom corner. Now progressively chooses a higher collision-tested elevation
  (up to just short of vertical) instead of forcing a minimum through walls.
  Three regression scenes have ~6 m camera separation; independent sampled
  segment clearance verifies no shared-solid/near-plane intersection. Actor
  smoothing remains; the secondary lagging pivot was removed to avoid wall drift.
- Invalid/unsupported/credential-bearing endpoint rejected with explicit
  `VITE_SERVER_URL` guidance; caught before resource acquisition. Actual browser
  boot with invalid env tested, not just a URL helper unit test.
- An unsupported GLB clip previously raised `undefined.loop` in Actor.
  Asset boundary rejects it with a clear Vietnamese error and owns the model
  before validation so failure cleanup frees it.
- Recovery previously returned `{}` if all points blocked and could return an
  occupied fallback. It now checks all clusters and a bounded full-campus grid,
  with item-clearance predicate and explicit exhaustion error. Tests cover NaN/
  infinite position and all first-cluster candidate points occupied.
- Matchmaker lock/unlock writes serialized; shared RECONNECT_MS used; room and
  entrypoint shutdown promises handled. Existing reserved-avatar gate interlock
  intentionally retained and tested through disconnect/reconnect.
- Q location ping outside interaction range was refused because player IDs were
  excluded from server targets. Reproduced RED, fixed to accept current-room
  player IDs while unknown IDs remain invalid. Malformed messages still consume
  intent budget; explicit regression verifies rejection then refill.
- ROUND_MS is shared by server and results. Removed deprecated shadow enum in
  favor of the same PCF behavior Three.js was already falling back to.

## Performance investigation follow-up (2026-10-05)

Detailed commands/evidence: `.superpowers/sdd/campus/performance-report.md`;
raw runs under `.superpowers/sdd/campus/performance/`.

**Severe slowdown reproduced without test-runner overhead and minimized to one
cube/12 triangles:** headed default framebuffer0.99–1.07FPS, offscreen59.97FPS,
headless59.74–60.00FPS. Desktop remote Wayland/LockedHint=yes; visible/focus/
pointer-lock did not detect this. Full-scene CPU render~1ms; async GPU median
4.76ms/p9512.35ms. Paired HUD/minimap/CSS/camera/shadow ablations did not cure
pacing. This isolates a browser/presentation bottleneck, not game CPU work.
Historical Task4 did not record lock state, so cannot retrospectively establish it.

Session later independently became unlocked. **Unchanged production**, high,
1920×1080,1rendered+3 real socket peers, trace/probe/video off,4s warmup/3×15s:

| Mode | Actual callbacks/s across repeats | p95 rAF |
|---|---|---|
| headed NVIDIA/OpenGL4.5 |59.93 /59.80 /59.93|16.8ms|
| headless NVIDIA/OpenGL ES3.2 |60.00 /59.73 /60.00|16.8ms|

Headed GPU15–35%, VRAM6772–6867MiB; other GPU apps remained running. One headed
repeat had66.8ms outlier. Stationary-spawn browser cadence on remote desktop,
not physical scanout/whole-round proof. Earlier headless production47–57FPS under
72–97% total GPU load is retained. Four production contexts still **10.93–12.27FPS
each**,p95~100ms/GPU89–97%; not four machines.

Harness now records real window/callback FPS, desktop state and separate performance
verdict; CAMPUS_REQUIRE_60FPS=1 enables explicit gate. Added standalone TEST-only
ablations and RED/GREEN verdict regressions. No runtime/quality reduction.
Offscreen/uncapped diagnostics excluded from acceptance. Affected broad acceptance
reruns **not fully green**: headed relocked/timeout; headless existing11-versus12
shader-program convergence assertion failed (buffers/textures stable). The strict
assertion was not relaxed. This historical blocker is resolved by the final fixes
above; it is retained here to preserve the chronology.

Final adverse repeat (`performance/final-harness-check`), with desktop verified
unlocked before/after: **24.53FPS**,p9566.6ms, total GPU78–96%, high/antialias true,
NVIDIA1920×1080. Thus unlocking alone is not sufficient; sustained60FPS remains
**partial**, despite the earlier genuine60FPS windows. No slow samples discarded.
Final typecheck PASS; focused verdict/client tests5files/23tests PASS. Rebuilt
archive and clean-extraction package smoke PASS (health/static/two clients/start/
reconnect). Runtime untouched; existing >500kB bundle warning remains.

## Historical Task4 hardware frame measurements

Fresh temporary Chromium profile, `--ozone-platform=x11 --use-gl=angle --use-angle=gl`;
desktop DISPLAY=:1. GL_RENDERER:
**ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.5.0)**.
Trace screencast disabled for measurements. CSS viewport and drawing buffer both
1920×1080, device scale 1. Each sample ~15 s after 2–2.5 s warmup. rAF interval
includes browser/compositor scheduling; it is not a GPU timer query.

| Renderers / quality | Frames | p50 ms | p95 ms | Mean ms / equivalent FPS |
|---|---:|---:|---:|---:|
| 1 rendered + 3 real socket-only clients, high | 298 | 50.0 | 100.0 | 50.14 / 19.9 |
| same, low | 253 | 66.6 | 83.5 | 58.93 / 17.0 |
| 4 rendered contexts, high, context 1 | 210 | 66.7 | 83.5 | 71.15 / 14.1 |
| context 2 | 210 | 66.8 | 100.0 | 71.07 / 14.1 |
| context 3 | 211 | 66.7 | 100.0 | 70.97 / 14.1 |
| context 4 | 211 | 66.8 | 100.0 | 71.05 / 14.1 |

These are four isolated browser contexts on **one host/GPU**, not four machines.
All four registered distinct identity, ready/start and actual key-driven movement;
another independent room remained lobby with its own sole player. LocalStorage
isolation checked. Four-render sample includes paused overlays after sequential
movement. All visibility values read `visible`; window compositor scheduling may
still differ. No claim that four humans can hold focus on one desktop at once.

Headless **hardware**, separately recorded, gave one-render high p50 33.4/p95 66.7,
mean40.56ms and four-render means171–210ms. This is not SwiftShader but not the
desktop result above either. Earlier traced runs suffered screencast/focus timing
and were rejected as acceptance runs. A blank hardware page measured ~16.6ms,
showing rAF was not globally capped at 20FPS. Five-second CPU profile was mostly
idle (3233 samples; top app render self samples26), which does not identify a
single safe visual-neutral optimization. Quality-low did not reliably improve
frame time. No geometry/animation was deleted to manufacture a pass.

Default/GL/Vulkan launch probes could identify NVIDIA. A forced Vulkan full-app
attempt failed to become ready within60s; default GL is the passing path. System
config/drivers and existing browser profiles were not modified. **These historical
measurements did not demonstrate60FPS.** The follow-up above supersedes the generic
profiling recommendation with actual isolation; its acceptance limits still apply.

## Networking and bounded load

- Full two/four real WS-client rounds use shared-route walking input and real
  pickup/place/hold intents. Contention has one winner; replay resets authority.
- New reserved-seat test rejects a replacement during disconnect then admits one
  after voluntary leave. Dedup test replays successful pickup after disconnect
  has dropped the item: original response reused, revision2 stays WORLD, no
  resurrected owner; changed payload under same ID returns REQUEST_CONFLICT.
- Test-only HTTP/WS forwarder applies 40–160ms ordered one-way delay/jitter,
  drops every13th application frame and interrupts actual sockets. Queues cap128,
  HTTP timeout5s and test deadline bounded. Application-message drop is a model
  above TCP, not literal lost TCP packets (TCP would retransmit). Browser run:
  11 dropped frames, max queue9, two connections, movement2.10m then stopped,
  reconnect kept identity and sequence102→126. No page errors.
- An old delayed-transport test waited for teammates but read the sender's older
  snapshot. Final suite caught it; fixed synchronization to await **all** recipients.
  Authority behavior was unchanged.

Separate server process, 4 real moving clients/room, 8s windows, CPU percent of
one logical core (not total machine); instrumentation observes actual Game.tick
duration and WS send bytes. Client automation lives outside measured process.

| Rooms/clients | CPU % | RSS MiB | ticks (~Hz/room) | tick p50/p95 ms | outbound bytes/window |
|---|---:|---:|---:|---:|---:|
| 1/4 | 13.16 | 133.20 | 240 (30.0) | .090 / 3.868 | 937,152 |
| 5/20 | 20.60 | 202.07 | 1189 (29.7) | .028 / 1.329 | 4,655,836 |
| 10/40 | 20.39 | 206.14 | 2356 (29.4) | .013 / .387 | 9,214,196 |

JIT warmup affects incremental costs; this is bounded capacity evidence, not a
linear scalability claim. Bytes exclude TCP/TLS headers, ~1.9–2.0KB snapshot,
~29KB/s/player at15Hz. Ten-room cleanup observed exactly10 WASM disposals;
five additional room start/leave cycles reached15. RSS stabilized around206.4MiB;
Node does not immediately return reserved heap pages to the OS.

Eight actual create/ready/start/leave cycles on same browser renderer returned
879 buffers /113 textures /14 programs on every cycle in desktop run. GC heap
35.12–35.34MB; backing storage43.81MB unchanged. These are instrumented WebGL
resource counts, not Three renderer.info counts. The old layout-based warmup
explanation was unsupported; see the final shader-source characterization above.
Not a long soak leak audit.

## Visual/audio evidence and limits

Root: `.superpowers/sdd/campus/`.

- `task4-final-browser-report/index.html`: 10-test report.
- `task4-final-browser/journey-*/`: title, lobby, campus, settings.
- `task4-final-browser/round-*/`: storage, carried crate, street, corridor,
  classroom clue, stage, festival1300 and replay. Round is **one keyboard browser
  plus one legitimate socket teammate**, not four rendered whole-round clients.
- `task4-before/camera-*/` and `task4-final-polish/camera-*/`: before/after PNG
  and camera JSON for south wall, storage, classroom corner.
- `task4-desktop-final/acceptance-*/hardware-four-browser.json`: primary hardware,
  movement, resource, payload evidence; four context screenshots included.
- `task4-measured/acceptance-*/hardware-four-browser.json`: separate hardware-headless run.
- `task4-load/load.json`: CPU/RAM/tick/send/disposal measurements; worker stopped.
- `task4-final-browser/media-*/`: ~5s actual animated title canvas VP9 WebM;
  original music/SFX Opus WebM plus `audio-signal.json`.
- `task4-media/media-profile-*/client.cpuprofile`: read-only CPU profile.
- `task4-review/index.html`: compact self-contained visual review gallery + JSON,
  canvas video and original audio (generated by `node tools/collect-evidence.mjs`).

WebAudio at both buses100%: peak0.1158, RMS0.01884, 163840 sampled float values;
non-silent, no measured clipping. This is signal-level testing, **not human
listening**. Video has actual varying frames at renderer cadence, not a guaranteed
30FPS animation acceptance (final recording:98 decoded frames /4.854s,1440×900 VP9).
This model's image tool reported unsupported input;
no invented visual verdict. Coordinator's independent visual/temporal review
must inspect the saved footage, especially near-overhead camera transitions and
small-prop grip/cadence. Four-machine LAN, internet latency, public HTTPS deployment,
human fun/accessibility review and a long-duration soak were not performed.

## Packaging

README includes local/LAN/HTTPS-WSS instructions, process env and build-time client
env, single-process routing/restart limitations. `.env.example`, multi-stage
Dockerfile, non-root systemd and Caddy templates, reproducible runtime tar builder,
runtime smoke driver, art/font/audio provenance are included. Caddy/service are
operator templates: no global install, enabled unit, DNS/TLS/public listener change.
Original Blender sources stay in checkout; runtime only needs built GLBs/fonts.

See `artifacts/package-smoke.json` and `artifacts/campus-together-0.1.0.tar.gz.sha256`
for extracted package install/run evidence and checksum. An independent final
review follows `.superpowers/sdd/campus/task-4-report.md`.
