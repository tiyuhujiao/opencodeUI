# opencode-ui

`opencode-ui` is a VS Code-compatible extension that brings an OpenCode chat interface into the IDE sidebar. It connects the extension host to the local or remote `opencode` CLI, starts `opencode serve` when needed, and renders sessions, streaming replies, tools, permissions, models, agents, todos, and image attachments in a React/Vite webview.

The extension is designed for VS Code and compatible IDEs such as Cursor.

## Features

- Sidebar chat UI for OpenCode inside the IDE activity bar.
- Automatic `opencode serve` startup on `127.0.0.1`, preferring port `4096` and falling back to a free port.
- Automatic `opencode` binary discovery across common Windows, Linux, WSL, and Remote-SSH install locations.
- Session listing, switching, export, deletion, timeline, undo, and redo.
- Model, provider, and agent selection with refresh support.
- Streaming transcript rendering for text, reasoning, tools, subtasks, todos, permission prompts, and question prompts.
- Temporary image/file prompt support with host-aware path normalization.
- Diagnostics popover and `/debug` support for self-checking sessions, models, agents, and request logs.

## Requirements

- VS Code-compatible host with extension API `>=1.105.0`.
- Node.js `>=20.0.0` and npm `>=10.0.0` for development.
- `opencode >=1.15.10` installed in the same host environment where the extension runs.

Check your CLI with:

```powershell
opencode --version
```

## Supported Hosts

| Host | Status | Notes |
| --- | --- | --- |
| Windows local | Supported | Finds `.exe`, `.cmd`, and `.bat` shims from npm, Volta, Scoop, Chocolatey, pnpm, Yarn, Bun, Mise, PATH, and common user install directories. |
| Linux local | Supported | Finds common user-level install directories such as `~/.opencode/bin`, `~/.local/bin`, Bun, pnpm, Volta, and Mise. |
| Remote-WSL | Supported | `opencode` must be installed inside the WSL distro, because the extension host runs there. |
| Remote-SSH Linux | Supported | `opencode` must be installed on the remote Linux machine. |
| Generic Linux remote | Supported | Treated like a Linux remote host. |
| macOS or non-Linux remotes | Not supported yet | The extension warns and skips `opencode serve` startup. |

You can override discovery with:

```powershell
$env:OPENCODE_BINARY = "C:\path\to\opencode.exe"
```

or on Linux/WSL:

```bash
export OPENCODE_BINARY=/path/to/opencode
```

## Install From Source

Install dependencies:

```bash
npm ci
npm --prefix webview-ui ci
```

Build and verify:

```bash
npm run check
```

Package a VSIX:

```bash
npm run package
```

Install the generated package into VS Code:

```bash
code --install-extension vsix/opencode-ui-0.0.75.vsix --force
```

Or into Cursor:

```bash
cursor --install-extension vsix/opencode-ui-0.0.75.vsix --force
```

Adjust the VSIX filename to match the current `package.json` version.

## Development

Useful commands:

```bash
npm run build
npm --prefix webview-ui run build
npm run watch
npm --prefix webview-ui run dev
npm test
npm run test:extension
```

The practical preflight before opening a PR or building a release is:

```bash
npm run check
```

Run the VS Code smoke test when extension activation or packaged behavior changes:

```bash
npm run test:extension
```

## Repository Layout

- `src/extension.ts` - extension activation, host detection, commands, and sidebar registration.
- `src/bridge/` - `opencode` CLI wrappers, serve manager, compatibility checks, and parsers.
- `src/shared/protocol.ts` - typed webview/extension message contract.
- `src/webview/SidebarProvider.ts` - bridge between VS Code, `opencode serve`, CLI helpers, and the webview.
- `webview-ui/` - React/Vite webview application.
- `tests/` - Vitest coverage for parsers, host detection, serve startup, run streams, UI state helpers, and regressions.
- `out/` and `media/` - generated extension runtime artifacts included in the VSIX.
- `vsix/` - local package output, ignored by git.

Do not hand-edit generated files in `out/` or `media/`; rebuild them with `npm run build`.

## CI

GitHub Actions runs the repository preflight and packages a VSIX artifact on pushes and pull requests:

```bash
npm run check
npm run package
```

## Troubleshooting

If the sidebar reports that `opencode` cannot be found:

- Run `opencode --version` in the same host where the extension runs.
- In Remote-WSL or Remote-SSH, install `opencode` in the remote environment, not only on Windows.
- Set `OPENCODE_BINARY` to an absolute executable path if your install location is unusual.
- Open the diagnostics popover in the sidebar and run the self-check.

If `4096` is occupied, the extension automatically starts `opencode serve` on another free port and caches that port per host kind.

## Release Notes

Release notes can be published through GitHub releases or the VSIX artifact description.

## License

MIT. See [`LICENSE`](./LICENSE).
