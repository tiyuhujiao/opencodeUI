import { describe, expect, it } from 'vitest';
import { parseFileReference } from '../webview-ui/src/fileReferences';
import { renderMarkdown } from '../webview-ui/src/markdown/renderMarkdown';

describe('clickable file references', () => {
  it('解析相对路径、Windows 绝对路径和行列号', () => {
    expect(parseFileReference('webview-ui/src/App.tsx:120:4')).toEqual({
      path: 'webview-ui/src/App.tsx',
      line: 120,
      column: 4
    });
    expect(parseFileReference('E:\\opencodeUI\\src\\extension.ts#L22')).toEqual({
      path: 'E:\\opencodeUI\\src\\extension.ts',
      line: 22,
      column: undefined
    });
    expect(parseFileReference('npm run check')).toBeNull();
    expect(parseFileReference('extension.ts')).toBeNull();
    expect(parseFileReference('extension.ts', { allowBareFilename: true })).toEqual({
      path: 'extension.ts',
      line: undefined,
      column: undefined
    });
  });

  it('把 markdown 链接和反引号路径渲染为安全的工作区文件按钮', () => {
    const rendered = renderMarkdown('[App](webview-ui/src/App.tsx#L120), `src/extension.ts:22`, plain tests/protocol.test.ts:115.');
    expect(rendered).toContain('class="file-reference"');
    expect(rendered).toContain('data-file-path="webview-ui/src/App.tsx"');
    expect(rendered).toContain('data-file-line="120"');
    expect(rendered).toContain('class="file-reference file-reference--code"');
    expect(rendered).toContain('data-file-path="tests/protocol.test.ts" data-file-line="115"');
    expect(rendered).not.toContain('javascript:');
  });

  it('只在反引号或显式链接中把裸文件名渲染为文件按钮', () => {
    const rendered = renderMarkdown('`extension.ts`, [protocol](protocol.ts), plain Node.js.');
    expect(rendered).toContain('data-file-path="extension.ts"');
    expect(rendered).toContain('data-file-path="protocol.ts"');
    expect(rendered).toContain('plain Node.js');
    expect(rendered).not.toContain('data-file-path="Node.js"');
  });
});
