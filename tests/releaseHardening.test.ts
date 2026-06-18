import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('release hardening', () => {
  it('提供 CI、check 脚本与 VSIX 打包边界', () => {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
    const vscodeIgnore = readFileSync(join(root, '.vscodeignore'), 'utf8');

    expect(packageJson.scripts.check).toContain('npm run lint');
    expect(packageJson.scripts.check).toContain('npm run build');
    expect(packageJson.scripts.check).toContain('npm test');
    expect(packageJson.scripts.ci).toContain('npm run package');
    expect(ci).toContain('npm run check');
    expect(ci).toContain('npm run package');
    expect(vscodeIgnore).toContain('out/test/**');
    expect(vscodeIgnore).toContain('out/**/*.map');
  });

  it('注册本地诊断输出通道命令', () => {
    const extensionSource = readFileSync(join(root, 'src/extension.ts'), 'utf8');
    const diagnosticsSource = readFileSync(join(root, 'src/diagnostics.ts'), 'utf8');

    expect(extensionSource).toContain('initializeDiagnostics(context)');
    expect(extensionSource).toContain("vscode.commands.registerCommand('opencodeUI.showDiagnostics'");
    expect(diagnosticsSource).toContain("createOutputChannel('OpenCode UI')");
  });
});
