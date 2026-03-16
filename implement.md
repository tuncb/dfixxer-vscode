Now implement the entire project end-to-end.

Non-negotiable constraint

    Do not stop after a milestone to ask me questions or wait for confirmation.
    Proceed through every milestone in plans.md until the whole project is complete and fully validated.

Execution rules (follow strictly)

    Treat plans.md as the source of truth. If anything is ambiguous, make a reasonable decision and record it in plans.md before coding.

    Implement deliberately with small, reviewable commits. Avoid bundling unrelated changes.

    After every milestone:
        run verification commands (lint, typecheck, unit tests, snapshots, and any integration checks)
        fix all failures immediately
        add or update tests that cover the milestone’s core behavior
        commit with a clear message that references the milestone name

    If a bug is discovered at any point:
        write a failing test that reproduces it
        fix the bug
        confirm the test now passes
        record a short note in plans.md under “Implementation Notes”

Validation requirements

    Maintain a “verification checklist” section in plans.md that stays accurate as the repo evolves.
    Determinism is required for serialization, ops journaling, replay, and export codegen. Enforce with snapshot tests and stable ordering.
