import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}), { virtual: true });

import { summarizeSessionTitle } from '../src/webview/SidebarProvider';

describe('summarizeSessionTitle', () => {
  it('为中文请求生成简短标题', () => {
    expect(summarizeSessionTitle('请帮我修复新建对话后标题一直显示 New Session 的问题')).toBe('修复新建对话后标题一直显示');
  });

  it('去掉英文礼貌前缀并截断过长请求', () => {
    expect(
      summarizeSessionTitle('Please help me investigate why the sidebar session title never updates after the first prompt completes')
    ).toBe('investigate why the sidebar session');
  });

  it('优先取首句作为标题', () => {
    expect(summarizeSessionTitle('实现自动会话标题。然后补一条测试验证行为。')).toBe('实现自动会话标题');
  });

  it('空白输入时回退到默认标题', () => {
    expect(summarizeSessionTitle('   ')).toBe('New Session');
  });
});
