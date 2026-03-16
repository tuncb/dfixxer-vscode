# Documentation

## Status
- Milestone 1 complete: project scaffold, TypeScript build, linting, and split unit/extension smoke tests.
- Milestone 2 complete: Pascal-only activation events, stub command registration, and the public `dfixxer` settings contract are defined in the extension manifest.
- Milestone 3 complete: settings/path resolution, managed executable layout, logging, and document-level re-entrancy guards are implemented with unit coverage.
- Milestone 4 complete: GitHub release discovery selects compatible `dfixxer` assets, includes prereleases, skips drafts, and emits actionable unsupported-platform errors.
- Milestone 5 complete: managed downloads, archive extraction, executable validation, metadata persistence, and rollback-safe install replacement are implemented and covered by unit plus extension-host tests.
- Milestone 6 complete: `Fix Current File` now runs through VS Code, saves dirty Pascal files once, resolves executable/config settings, reloads on success, and reports process failures through the `dfixxer` output channel plus user-facing errors.
- Milestone 7 complete: `Create Configuration File` now chooses a sensible default target, confirms overwrite, ensures `dfixxer` is available, runs `init-config`, and opens the resulting TOML file.
- Milestone 8 complete: format-on-save now reuses the same fix pipeline, runs only for Pascal/Object Pascal files, skips non-file documents, suppresses command-managed saves, and avoids repeated failure retries.
- Milestone 9 complete: first-use install prompts now cover fix and create-config, and `Update dfixxer` installs or no-ops the managed binary while warning if an explicit executable override remains in effect.
- Milestone 10 complete: README usage docs, CI, VSIX packaging, and final validation are in place. The repo now produces `dfixxer-vscode-0.0.1.vsix`.
