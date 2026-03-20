# Code Review Findings

## Finding 1

**Severity:** P1  
**File:** `src/extensionController.ts:320`

### Successful format reload is not scoped to the original document

`runFix` captures the original Pascal document, but after awaiting the external formatter it reloads through `workbench.action.files.revert`, which is scoped to whichever editor is active at that moment rather than to that URI. If the user switches tabs or keeps typing before `dfixxer` returns, this completion path can either reload the wrong editor or discard fresh edits in the formatted file. The reload needs to be targeted to the original document and should bail out if that document became dirty again while the process was running.

## Finding 2

**Severity:** P1  
**File:** `src/extensionController.ts:274`

### Update no-op trusts metadata instead of the installed binary

`installLatestManagedExecutable` returns `noop` as soon as `metadata.json` says the current tag matches and the executable path exists. That is unsafe here because installation writes metadata from the selected asset tag, while validation only checks that `dfixxer version` exits successfully and never compares the reported version to the requested release. A mislabeled asset or later-corrupted binary will therefore be treated as current forever, and `Update dfixxer` cannot self-repair the managed install.

## Finding 3

**Severity:** P2  
**File:** `.github/workflows/ci.yml:57`

### CI packages a fresh checkout without compiling extension output

The `package` job re-checks out the repository and runs only `npm ci` followed by `npm run package`. Because `.gitignore` excludes `out/`, `package.json` points the extension entrypoint at `./out/extension.js`, and there is no `vscode:prepublish` hook, this job is not packaging the same artifact that the release workflow tests. On a fresh runner it can either produce a broken VSIX or stop validating packaging altogether; add an explicit compile step or a `vscode:prepublish` script before `vsce package`.
