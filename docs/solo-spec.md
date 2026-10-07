# Solo and audit fixes — approved extension

This document supersedes the original spec only for explicitly listed mode-dependent rules. User approved the complete design and build on 2026-10-05. Preserve the complete campus, original assets/audio, authority and co-op gameplay. No public deployment, commits, paid services or user configuration changes.

## Rules
- Server-owned immutable room mode `solo | coop`, exposed in snapshots. Legacy creation defaults to coop. Solo capacity 1; coop 4. Reconnect is not a new join.
- Title has Chơi một mình, Tạo phòng cùng bạn, Tham gia phòng. Solo creates a room and starts without a second player; show onboarding before accepting movement.
- Full three-phase mission and both optional objectives remain. One carried item, reach/LOS/revision/dedup and anti-cheat unchanged.
- Solo duration 18 minutes; coop 12. Snapshot/UI results reflect actual mode duration. Simulation clock continues during pause/disconnect.
- Solo gate: empty-handed player holds E for 1 second continuously within reach to open for 15 seconds. Release before charge complete resets charge. After activation release/repress is needed to reactivate; countdown server-owned. Retain doorway safety interlock. Coop gate unchanged.
- Solo clue: read normally in classroom; show retained clue during power. Do not leak undiscovered clue in snapshots. Restore discovered clue on reconnect for the same player if needed.
- Solo launch: hold station A continuously 3 seconds, latch completion; then hold station B continuously 3 seconds to finish. Partial charge resets on release/invalid reach/disconnect. Completed A survives reconnect. B before A does not progress. Empty hands and phase/reach validation apply. Coop requires two distinct simultaneous holders for 3 seconds unchanged.
- Solo never ends for having only one connected player. Reconnect seat 30 seconds and held-item drop after 3 seconds unchanged. Explicit leave ends empty room through normal cleanup. Replay resets all round progress and retains mode.
- Solo cannot be joined by a second person. Coop never changes into solo on departures. Results clearly label mode.

## Confirmed audit fixes
- Preserve title name/room input through asset completion and settings close.
- Shared lobby eligibility matches server, including reserved disconnected seats; explain blocked start.
- Accessible noninteractive live announcements remain available with modal open; no focus leakage to background controls.
- Send immediate stop/release when pausing; cease repeated paused movement input; resume sequence/prediction correctly.
- Symbol hotkeys only operate in power while active input allowed.
- Remove dead settings fallback assignment. Share equivalent globe materials if it preserves appearance.
- Add rate/refill, sync-throttle and all-spawn reachability tests where meaningful. `/health` remains documented liveness.
- Public room admission hardening is a separate deployment concern; don't introduce unverified proxy directives or change user's network exposure.

## Acceptance
- Solo full round with actual normal movement/actions on all 3 layouts; no teleport or production test bypass. Optional score, results, replay.
- Disconnect with item and after A latch; no duplication/loss of confirmed progress. Incomplete hold never completes. Second-player join rejected.
- Co-op 2/4-player completion and room isolation remain passing.
- UI loading/settings input persistence, start eligibility, modal live announcements, pause stop/no spam/resume, hotkeys regressions.
- Real browser solo title→game→results→replay evidence plus existing co-op tests; browser console clean.
- Typecheck/build/full relevant suites, archive fresh extraction smoke/checksum. Record precise test counts and limitations.
- Re-measure representative gameplay when feasible; stable1080p60 remains unaccepted unless measured. Never infer visual/temporal/audio acceptance from static source.
