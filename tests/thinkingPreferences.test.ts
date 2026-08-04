import { describe, expect, it, vi } from 'vitest';
import {
  readThinkingPreferences,
  THINKING_PREFERENCES_STORAGE_KEY,
  writeThinkingPreferences
} from '../webview-ui/src/thinkingPreferences';

describe('thinking preferences', () => {
  it('按模型读取有效选择并忽略损坏数据', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        'cpa/gpt-5': 'high',
        'openai/gpt-4.1': 'off',
        '': 'max',
        invalid: 42
      }))
    };

    expect(readThinkingPreferences(storage)).toEqual({
      'cpa/gpt-5': 'high',
      'openai/gpt-4.1': 'off'
    });
    expect(readThinkingPreferences({ getItem: () => '{bad json' })).toEqual({});
  });

  it('使用稳定 storage key 写入每个模型的选择', () => {
    const setItem = vi.fn();
    writeThinkingPreferences({ setItem }, { 'cpa/gpt-5': 'max' });

    expect(setItem).toHaveBeenCalledWith(
      THINKING_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ 'cpa/gpt-5': 'max' })
    );
  });
});
