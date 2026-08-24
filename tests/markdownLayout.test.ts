import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../webview-ui/src/markdown/renderMarkdown';

describe('Markdown layout', () => {
  it('wraps tables in a keyboard-scrollable region without changing table semantics', () => {
    const rendered = renderMarkdown(`| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| M0 摸底 | 启动 Devin | 拿到 RPC 列表 |`);

    expect(rendered).toContain('<div class="md-table-scroll" role="region" aria-label="Markdown table" tabindex="0"><table>');
    expect(rendered).toContain('<thead>');
    expect(rendered).toContain('<tbody>');
    expect(rendered).toMatch(/<\/table>\s*<\/div>/);
  });

  it('keeps Markdown content within its message while preserving the table grid', () => {
    const styles = readFileSync(join(process.cwd(), 'webview-ui/src/styles.css'), 'utf8');

    expect(styles).toMatch(/\.md-body \{\s*min-width: 0;\s*max-width: 100%;/);
    expect(styles).toMatch(/\.md-body ul,\s*\.md-body ol \{[\s\S]*?padding-inline-start: 1\.4rem;/);
    expect(styles).toMatch(/\.md-table-scroll \{[\s\S]*?overflow-x: auto;[\s\S]*?border: 1px solid var\(--ui-border-strong\);/);
    expect(styles).toMatch(/\.md-body table \{[\s\S]*?min-width: 100%;[\s\S]*?border-collapse: separate;/);
    expect(styles).toMatch(/\.md-body th,\s*\.md-body td \{[\s\S]*?min-width: 7\.25rem;[\s\S]*?border-inline-end: 1px solid var\(--ui-border\);/);
    expect(styles).toMatch(/\.md-body tr > :first-child \{[\s\S]*?white-space: nowrap;/);
  });
});
