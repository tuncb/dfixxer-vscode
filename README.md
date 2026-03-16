# dfixxer VS Code Extension

`dfixxer-vscode` is a thin Visual Studio Code wrapper around the [`dfixxer`](https://github.com/tuncb/dfixxer) executable for Delphi/Pascal formatting.

## Features

- `dfixxer: Fix Current File`
- `dfixxer: Create Configuration File`
- `dfixxer: Update dfixxer`
- Optional format-on-save for `pascal` and `objectpascal` files
- Managed executable downloads stored in VS Code global storage

## First Run

If `dfixxer.executablePath` is empty and no managed binary is installed yet, the extension prompts to install the latest compatible `dfixxer` release the first time you run:

- `dfixxer: Fix Current File`
- `dfixxer: Create Configuration File`

Managed installs currently support:

- Windows `x64`
- Linux `x64`
- macOS `x64`

If your platform is unsupported, point `dfixxer.executablePath` at a compatible local binary instead.

## Commands

### `dfixxer: Fix Current File`

- Validates that the active editor is a Pascal/Object Pascal file on disk
- Saves once if the document is dirty
- Runs `dfixxer update <file>` with `--config <path>` only when `dfixxer.configurationFile` is set
- Reloads the editor from disk after a successful format

### `dfixxer: Create Configuration File`

- Prefills the save dialog with `<workspace root>/dfixxer.toml`
- Falls back to the active file folder when there is no workspace
- Confirms before overwriting an existing target
- Runs `dfixxer init-config <target>` and opens the generated file

### `dfixxer: Update dfixxer`

- Downloads or updates the managed executable to the latest compatible release
- Includes prereleases by default
- Returns a no-op when the installed managed tag already matches the latest compatible tag
- Still updates the managed copy when `dfixxer.executablePath` is set, but warns that the override remains authoritative

## Settings

### `dfixxer.configurationFile`

- Type: `string`
- Default: `""`
- Empty means the CLI decides config discovery
- Non-empty values may be absolute or workspace-relative

### `dfixxer.formatOnSave`

- Type: `boolean`
- Default: `false`
- When enabled, runs `dfixxer` after saving `pascal` and `objectpascal` files

### `dfixxer.executablePath`

- Type: `string`
- Default: `""`
- Empty means use the managed binary in VS Code global storage
- Non-empty values may be absolute or workspace-relative

## Managed vs Override Executables

- The managed executable lives under VS Code global storage in `bin/<platform>-<arch>`.
- `dfixxer.executablePath` always takes precedence over the managed executable for fix and create-config commands.
- `dfixxer: Update dfixxer` only updates the managed copy; it never edits the override path.

## Development

```powershell
npm ci
npm test
npm run package
```

## Releases

- Pushing a tag named `v*` triggers the GitHub release workflow.
- The tag must match `package.json` exactly, for example `package.json` version `0.0.2` requires tag `v0.0.2`.
- The workflow runs lint, compile, unit tests, extension tests, packages the extension, and uploads the generated `.vsix` to the GitHub release for that tag.
- No Visual Studio Marketplace publish step runs in this workflow.
