# Backend hardening implementation plan

Spec: docs/backend-hardening-spec.md

1. Read contracts and pinned Colyseus HTTP/lifecycle implementation. Write meaningful failing regressions, then fix contributor lifecycle, results gate normalization and protocol constants.
2. Implement server-owned admission and readiness modules with explicit ownership/disposal; validate all allocation routes against actual pinned framework dispatch. Add deterministic unit and real HTTP/socket tests. Update operating docs.
3. Run targeted and full backend regressions, typecheck/build; produce implementation report under .superpowers/sdd/backend-hardening/. Preserve current live release.
4. Independent scoped spec/quality review, consolidate findings into one fix pass, re-review changed surfaces.
5. Clean source-staged immutable package, verify before installation, fresh-extraction smoke. Verify current project-owned listener before graceful replacement and smoke actual localhost afterward.

No commits or production debug hooks. Implementation workers do not delegate. Reviewers read actual source and report concrete findings. Existing frontend appearance is outside change scope.
