# Play journey refinement — approved 2026-10-06

Extends spec.md and solo-spec.md only in the behaviors below. User approved scope and uninterrupted implementation. Preserve original complete campus, assets, audio, all three phases/optional objectives, Solo18min/Coop12min, authority/revision/reach/LOS/dedup/reconnect and immutable modes. No commits, public deployment or user profile/config changes.

## Required behavior
1. Explicit title intents: Enter in room-code input joins that code, never Solo. Invite links highlight joining; preserve typed fields and validation feedback. Prevent concurrent create/join submissions.
2. Recoverable play activation: pointer-lock failure retains usable resume menu; audio initialization/resume failure is nonfatal and correctly explained. Concurrent resume clicks have one activation owner; stale async completions cannot resurrect a left/disposed session or unlock a newer session.
3. Context prompts distinguish actionable, blocked and completed. Carrying objects near gate/clue/station explains G to drop. Solo B before A explains requirement; completed A redirects B. Blocked prompts never emit hold/actions. Backend must enforce the same rules/reasons for direct requests. Preserve gate doorway safety and completed A latch.
4. Held objects highlight only compatible unfinished destination(s), respecting current phase/slot. Completed destinations are visually distinct/not advertised as outstanding. Minimap has concise legend and own-player heading. First-use tips for pickup/drop/gate explain controls without obscuring play; no undiscovered clue leaks or hidden solution hints.
5. Symbol pings are keyboard badges [1]/[2]/[3] rather than unusable clickable controls during pointer lock. Only power/active play permits symbol pings.
6. Solo replay: one results action resets and starts the new Solo round authoritatively, then presents resume/onboarding; no ready/start lobby steps. Co-op replay returns to an **unready lobby**, where everyone readies again (existing behavior; “ready lobby” names the ready-up flow, not pre-readied players). Duplicate/stale requests cannot reset/start twice. Full round state/held items/clue/score/timer/prediction reset correctly.
7. Leaving an active round requires an accessible confirmation: Stay vs Leave (progress not retained). Stay sends no leave or inventory mutation and restores usable pause flow. Lobby/results leave immediate. Reload-resume is not introduced. Session cleanup during pagehide remains correct.
8. Clock continues during onboarding/pause as currently specified; explain this clearly. No new preparation phase or pause exploit.

## Acceptance
- Reproduce original title Enter/audio failure/action ambiguity before fixes where applicable. Behavioral regression tests including async resume cancellation/race, client/server blocked reasons, replay duplicate/old requests, and leave cancellation.
- Existing Solo full rounds/layouts and Coop2/4/isolation/reconnect remain passing. Update legitimate old replay expectations, never weaken authority tests.
- Browser journey using only rendered UI/normal controls for discoverability; no production teleport/debug/test bypass and no hidden coordinates for this separate qualitative journey. Keep deterministic helpers for regression tests, distinctly labeled.
- Capture actual evidence, console errors, limitations. Agent walkthrough is not human fun acceptance. Stable1080p60 must be measured, not promised; do not kill user GPU processes or alter profiles/compositor.
- Typecheck/build/relevant full suites; clean source-staged content-addressed archive/fresh extraction smoke; independent review then activate coherent release localhost2567, verify real Solo/Coop after restart.
