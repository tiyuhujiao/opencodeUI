# Contributing

Thanks for helping improve `opencode-ui`.

## Setup

Use npm for both the root extension project and the webview app:

```bash
npm ci
npm --prefix webview-ui ci
```

The project expects Node.js `>=20.0.0` and npm `>=10.0.0`.

## Development Workflow

- Use `npm run build` for a full extension and webview build.
- Use `npm --prefix webview-ui run dev` for the webview development server.
- Use `npm run watch` for TypeScript watch mode on the extension host.
- Use `npm test` for the Vitest suite.
- Use `npm run check` before submitting changes.
- Use `npm run test:extension` when extension activation or packaged IDE behavior changes.

## Generated Files

`out/` and `media/` are generated runtime artifacts included in the packaged extension. Do not edit them by hand. Change source files under `src/` or `webview-ui/src/`, then rebuild.

Local VSIX packages belong in `vsix/` and should not be committed.

## Change Hotspots

Message contract changes must stay synchronized across:

- `src/shared/protocol.ts`
- `src/webview/SidebarProvider.ts`
- `webview-ui/src/App.tsx`

Cross-platform runtime changes should include tests for Windows, Linux, WSL, or Remote-SSH behavior where applicable.

## Pull Request Checklist

- Explain the user-visible change or maintenance goal.
- Include focused tests for behavior changes.
- Run `npm run check`.
- Run `npm run test:extension` for extension activation, packaging, or VS Code API changes.
- Note whether the change affects shipped extension behavior.

## Release Checklist

For release-impacting changes:

1. Bump `package.json` version.
2. Run `npm run check`.
3. Run `npm run test:extension` when relevant.
4. Run `npm run package`.
5. Install the generated VSIX in the target IDE and verify the installed extension version.
6. Update `修改日志.md` with a Chinese release note.
