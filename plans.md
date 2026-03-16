# Plan: `dfixxer` VS Code Extension

## Summary
Build a TypeScript VS Code extension in `C:\work\dfixxer-vscode` as a thin wrapper over the `dfixxer` executable from `https://github.com/tuncb/dfixxer`. The extension will target `pascal` and `objectpascal` documents, manage a downloaded binary in VS Code global storage, and expose three commands: create config, fix current file, and update `dfixxer`. Auto-format will run after save, not before save.

## Public Interface
- Commands: `dfixxer.createConfig`, `dfixxer.fixCurrentFile`, `dfixxer.updateExecutable`
- Settings: `dfixxer.configurationFile` as `string` with default `""`, `dfixxer.formatOnSave` as `boolean` with default `false`, `dfixxer.executablePath` as `string` with default `""`
- Settings path rules: empty string means "use managed/default behavior"; non-empty values may be absolute or workspace-relative
- Managed install location: `context.globalStorageUri` under a platform-specific `bin/<platform>-<arch>` folder with a small metadata file storing installed tag/version and asset name

## Milestones

### 1. Scaffold the extension project
Create `package.json`, `tsconfig.json`, ESLint config, VS Code test config, `src/extension.ts`, and split test entrypoints into pure unit tests and VS Code extension tests.

Status: complete on 2026-03-16.

Acceptance criteria:
- A clean checkout can install dependencies.
- TypeScript compilation succeeds.
- Linting succeeds.
- An empty smoke test suite runs successfully.

Validation commands:
```powershell
npm ci
npm run compile
npm run lint
npm test
```

### 2. Define the manifest contract
Register Pascal activation events, the three commands, and the three settings with the exact defaults above; use the `dfixxer` namespace for commands and configuration.

Acceptance criteria:
- Commands are visible in VS Code.
- Settings are visible in VS Code.
- Activation is limited to Pascal language usage or explicit command invocation.

Validation commands:
```powershell
npm run compile
npm run test:extension
```

### 3. Build the execution foundation
Add modules for settings resolution, workspace-relative path expansion, output-channel logging, and a per-document re-entrancy guard used by both manual fix and save-triggered fix flows.

Acceptance criteria:
- The extension can resolve an override executable path.
- The extension can resolve a managed executable path.
- The extension can represent a missing-binary state deterministically.
- Resolution decisions are logged to a `dfixxer` output channel.

Validation commands:
```powershell
npm run compile
npm run test:unit
```

### 4. Implement GitHub release discovery
Add a release client that queries `tuncb/dfixxer` releases, ignores drafts, includes prereleases by default, and selects the first compatible asset for the current platform.

Acceptance criteria:
- Asset mapping matches the existing release workflow names exactly:
  - `dfixxer-windows-x86_64-<tag>.zip`
  - `dfixxer-linux-x86_64-<tag>.tar.gz`
  - `dfixxer-macos-x86_64-<tag>.tar.gz`
- Unsupported OS/arch returns an actionable error pointing users to `dfixxer.executablePath`.

Validation commands:
```powershell
npm run compile
npm run test:unit
```

### 5. Implement managed download and install
Download the selected asset to a temp directory, extract it, validate the binary with `dfixxer version`, then atomically replace the managed binary and write metadata.

Acceptance criteria:
- Windows zip installs work.
- Unix tar.gz installs work.
- Unix binaries are marked executable.
- Failed downloads or extractions never replace a previously working managed binary.
- Metadata is updated only after validation succeeds.

Validation commands:
```powershell
npm run compile
npm run test:unit
npm run test:extension
```

### 6. Implement `Fix Current File`
For the active Pascal editor, save once if dirty, suppress the save hook for that single save, run `dfixxer update <file>` with optional `--config <resolved path>`, then reload the editor from disk on success.

Acceptance criteria:
- Dirty files are not double-formatted.
- Non-Pascal files are rejected cleanly.
- Empty `configurationFile` omits `--config`.
- Process failures surface stdout and stderr through the output channel plus a user-facing error.

Validation commands:
```powershell
npm run compile
npm run test:extension
```

### 7. Implement `Create Configuration File`
Prompt with a save dialog prefilled to `<workspace root>/dfixxer.toml`; if no workspace exists, fall back to the active file’s folder or an empty save dialog; confirm before overwriting because `dfixxer init-config` overwrites existing files.

Acceptance criteria:
- The command resolves or installs the executable before use.
- The command runs `dfixxer init-config <target>`.
- The created file is opened or revealed after success.
- Existing targets require explicit overwrite confirmation.

Validation commands:
```powershell
npm run compile
npm run test:extension
```

### 8. Implement auto-format on save
Subscribe to `onDidSaveTextDocument` and reuse the same fix pipeline when `dfixxer.formatOnSave` is true.

Acceptance criteria:
- Only `pascal` and `objectpascal` documents are processed.
- Untitled and non-file documents are skipped.
- Command-triggered saves do not loop.
- Failures do not trigger repeated retries.

Validation commands:
```powershell
npm run compile
npm run test:extension
```

### 9. Implement `Update dfixxer` and first-use bootstrap
Add a command that installs or updates the managed binary to the latest compatible release, including prereleases; if the installed tag already matches, return a no-op status.

Acceptance criteria:
- First use of fix or create-config prompts to install when no managed binary exists.
- Update touches only the managed binary.
- When `dfixxer.executablePath` is set, the command still updates the managed copy but warns that the override remains authoritative.
- Already-current managed installs return a no-op result.

Validation commands:
```powershell
npm run compile
npm run test:unit
npm run test:extension
```

### 10. Finish release readiness
Add README usage docs, settings docs, platform support notes, CI mirroring the reference extension’s Node 22 compile/lint/test flow across Windows, macOS, and Linux, and VSIX packaging.

Acceptance criteria:
- The repo produces an installable `.vsix`.
- CI covers unit tests and extension tests.
- The README documents first-run download, override behavior, and the three commands.

Validation commands:
```powershell
npm run lint
npm test
npm run package
```

## Test Plan
- Unit tests: release selection with prereleases, asset-name mapping, unsupported platform handling, path resolution, archive extraction, metadata persistence, and install rollback on failure.
- Extension tests: command registration, manual fix flow with a stub executable, create-config overwrite confirmation, auto-save loop suppression, first-run install prompt, and override-path precedence.
- Smoke scenario: package the extension, launch an Extension Development Host, point `dfixxer.executablePath` at a known binary or let managed install run, then verify fix, config, and update against a sample Pascal workspace.

## Assumptions And Defaults
- v1 supports only the architectures currently published by `dfixxer` releases: `win32-x64`, `linux-x64`, and `darwin-x64`.
- `dfixxer.formatOnSave` defaults to `false` to avoid surprise writes.
- `dfixxer.configurationFile` and `dfixxer.executablePath` support absolute paths and workspace-relative paths; empty means "use default behavior".
- The extension does not register a VS Code `DocumentFormattingEditProvider` in v1; formatting is exposed through the command and the post-save hook.
- The create-config command uses the installed `dfixxer init-config` output rather than shipping a separate template, so config shape always matches the installed binary version.

## Verification Checklist
- [x] `npm ci`
- [x] `npm run compile`
- [x] `npm run lint`
- [x] `npm run test:unit`
- [x] `npm run test:extension`
- [x] `npm test`
- [ ] `npm run package`

## Implementation Notes
- Milestone 1: Scaffolding will use a compiled TypeScript + Mocha setup with separate Node unit tests and VS Code-hosted extension tests so later milestones can add coverage without changing the test harness.
- Milestone 1: Validation passed with `npm ci`, `npm run compile`, `npm run lint`, `npm run test:unit`, `npm run test:extension`, and `npm test`.
