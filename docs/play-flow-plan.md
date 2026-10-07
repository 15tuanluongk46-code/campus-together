# Play flow implementation plan

**Goal:** Make entry, contextual gameplay and replay understandable and robust.
**Spec:** docs/play-flow-spec.md (binding), existing docs/contracts.md and solo-spec.md.
**Architecture:** Keep existing client/session/domain boundaries; shared pure eligibility for action reasons where useful; server remains authority. Existing isolated project feat/campus-together, no commits authorized.

## Task 1 — Integrated refinement
Read spec and actual current code; implement all eight behaviors in coherent increments with meaningful RED/GREEN tests. Likely files: apps/client/src/{ui,main,audio,input,model,session,scene,world-art}.ts; apps/server/src/{domain,sessions,missions,validation}.ts; packages/shared/src/protocol.ts and any focused shared interaction module needed. Use small focused modules, no broad unrelated refactor.
- Inspect tests/e2e/{journey,solo,focus,feedback,lifecycle}.spec.ts and tests/{client,unit,integration} before changes.
- Test entry intent, single-flight activation and failure recovery, empty-hands/ordered stations, destination guidance, first-use tips and keyboard pings.
- Implement server atomic Solo replay and exact retry/round-boundary regressions. Preserve current sequence/reconnect invariants.
- Test leave cancel/confirm and modal focus/live status; update runtime browser smoke for deliberate confirmation.
- Run typecheck/full relevant tests/E2E/build; document precise commands, counts and failures.
- Read webapp-testing/app-ux-review for real browser-only discovery pass and performance measurement. Collect screenshots/short clips; don't claim visual inspection unsupported by tools.
- Update controls/contracts/verification/delivery docs. Package source-staged immutable archive and fresh smoke WITHOUT replacing current localhost runtime yet.
- Report .superpowers/sdd/play-flow/implementation-report.md with changed files, evidence, limitations and archive hash.

## Task 2 — Independent review and repair
Controller dispatches independent reviewer on source plus report/spec. No nested agents. One consolidated repair dispatch for confirmed findings then scoped re-review. Actual full-source review because unborn Git has no commit baseline. Record rulings and unresolved limitations.

## Task 3 — Release activation
Verify immutable hash/runtime tree before npm ci --omit=dev in new releases/<hash>. Verify existing listener PID/cwd belongs to project; gracefully stop only that process. Launch new release with detached subprocess HOST127.0.0.1 PORT2567. Run actual endpoint socket and browser smoke; rollback to prior intact release if failed. Preserve evidence/ledger/source (no Git cleanup). Report accurate coverage and performance acceptance.
