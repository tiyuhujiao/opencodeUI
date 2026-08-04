import { describe, expect, it } from 'vitest';
import { isComposerCommandInvocation, resolveComposerCommandInvocation } from '../webview-ui/src/composerCommands';

const commands = [
  { name: 'review', description: 'Review changes', source: 'command' as const, hints: ['focus'], },
  { name: 'browser:inspect', source: 'mcp' as const, hints: [] }
];

describe('native composer commands', () => {
  it('按 OpenCode 返回的规范名称解析 slash command 与参数', () => {
    expect(resolveComposerCommandInvocation('  /REVIEW src/app.ts ', commands)).toEqual({
      name: 'review',
      arguments: 'src/app.ts'
    });
    expect(resolveComposerCommandInvocation('/unknown value', commands)).toBeNull();
  });

  it('选中命令后只在 composer 仍属于该命令时抑制候选菜单', () => {
    expect(isComposerCommandInvocation('/browser:inspect page', 'browser:inspect')).toBe(true);
    expect(isComposerCommandInvocation('/review page', 'browser:inspect')).toBe(false);
  });
});
