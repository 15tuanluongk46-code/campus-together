# Solo + audit implementation plan

Spec: `docs/solo-spec.md`. Follow existing project contracts; update docs/contracts.md, controls, delivery and verification for changes. No commit/push. Use subagent-driven-development with implementer then independent review.

## Task 1 — Complete integrated mode extension
Files: packages/shared/src/{protocol,world,index}.ts and mode rules module as needed; apps/server/src/{model,domain,missions,sessions,room}.ts; apps/client/src/{ui,model,main,session,world-art}.ts; focused new tests and existing fixtures; docs/contracts.md and controls.md.
Consumes: approved solo-spec, existing code/contracts and assets.
Produces: typed immutable mode; explicit authoritative gate/station progress; complete solo frontend; confirmed audit fixes.
1. Inspect current APIs and tests. Add behavior regressions first and capture meaningful RED results.
2. Implement shared mode/duration/start eligibility; transport creation/capacity and server progression; test unit and real sockets including reconnect/replay.
3. Implement UI, mode-dependent instructions/countdowns and all approved audit corrections; test observable flows.
4. Run typecheck/build and entire relevant test suite; full solo rounds all layouts and original 2/4 co-op.
5. Capture browser evidence and report `.superpowers/sdd/solo/implementation-report.md` with exact commands/results, touched files and limitations.

## Task 2 — Independent review and fixes
Review spec compliance and source quality against spec and report. New project still unborn branch: full source/changed-file review, no fictitious commit diff. Consolidate findings into one scoped fixer; re-review corrections.

## Task 3 — Delivery
Run affected/final verification as warranted, regenerate runtime artifact/checksum and smoke fresh extraction. Update docs with solo controls and honest performance limits. Restart only project-owned local production after verifying process/port; health/static smoke. Record `.superpowers/sdd/solo/progress.md` and final handoff.
