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
    const vsceIgnore = readFileSync(join(root, 'scripts/vsce-files.txt'), 'utf8');
    const githubPackager = readFileSync(
      join(root, 'github-upload/package-github-release.js'),
      'utf8',
    );

    expect(packageJson.scripts.check).toContain('npm run lint');
    expect(packageJson.scripts.check).toContain('npm run build');
    expect(packageJson.scripts.check).toContain('npm test');
    expect(packageJson.scripts.ci).toContain('npm run package');
    expect(ci).toContain('npm run check');
    expect(ci).toContain('npm run package');
    expect(ci).toContain('ubuntu-latest');
    expect(ci).toContain('windows-latest');
    expect(ci).toContain('macos-latest');
    expect(ci).toContain("if: runner.os == 'macOS'");
    expect(ci).toContain('npm run test:extension');
    expect(ci).toContain('https://opencode.ai/install');
    expect(packageJson.scripts.package).toContain(
      '--ignoreFile scripts/vsce-files.txt',
    );
    expect(githubPackager).toContain('"--ignoreFile"');
    expect(githubPackager).toContain('ignoreFilePath');
    expect(vsceIgnore).toContain('.gitignore');
    expect(vsceIgnore).toContain('.vscodeignore');
    expect(vsceIgnore).toContain('SECURITY.md');
    expect(vsceIgnore).toContain('out/test/**');
    expect(vsceIgnore).toContain('out/**/*.map');
    expect(vsceIgnore).toContain('out/**/*.d.ts');
  });

  it('注册本地诊断输出通道命令', () => {
    const extensionSource = readFileSync(join(root, 'src/extension.ts'), 'utf8');
    const diagnosticsSource = readFileSync(join(root, 'src/diagnostics.ts'), 'utf8');

    expect(extensionSource).toContain('initializeDiagnostics(context)');
    expect(extensionSource).toContain("vscode.commands.registerCommand('opencodeUI.showDiagnostics'");
    expect(diagnosticsSource).toContain("createOutputChannel('OpenCode UI')");
  });
});
