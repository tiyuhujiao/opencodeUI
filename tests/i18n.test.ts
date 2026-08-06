import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translate } from '../webview-ui/src/i18n';

const root = process.cwd();

describe('webview internationalization', () => {
  it('translates interface copy while leaving English mode unchanged', () => {
    expect(translate('zh-CN', 'Fetch models')).toBe('拉取模型');
    expect(translate('zh-CN', 'Fetching upstream models...')).toBe('正在拉取上游模型...');
    expect(translate('zh-CN', 'Subtasks ({count})', { count: 3 })).toBe('子任务（3）');
    expect(translate('en', 'Fetch models')).toBe('Fetch models');
  });

  it('keeps technical parameters and transcript process terms in English', () => {
    for (const label of [
      'API key',
      'Model ID',
      'baseURL',
      'headers',
      'Reasoning effort',
      'Service tier',
      'Thinking',
      'Tool',
      'Tool calls'
    ]) {
      expect(translate('zh-CN', label)).toBe(label);
    }
    expect(translate('zh-CN', 'Tools ({count})', { count: 3 })).toBe('Tools (3)');
  });

  it('persists the language choice and defaults from the host language', () => {
    const source = readFileSync(join(root, 'webview-ui/src/i18n.tsx'), 'utf8');
    expect(source).toContain("const LANGUAGE_STORAGE_KEY = 'opencode-ui.language'");
    expect(source).toContain('window.localStorage.getItem(LANGUAGE_STORAGE_KEY)');
    expect(source).toContain('window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next)');
    expect(source).toContain("window.navigator.language.toLowerCase().startsWith('zh')");
    expect(source).toContain('document.documentElement.lang = language');
  });
});
