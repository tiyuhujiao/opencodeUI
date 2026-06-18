import { describe, expect, it } from 'vitest';
import {
  findThinkingOption,
  getThinkingOptionsForModel,
  getThinkingSelectionValue,
  toThinkingSelection
} from '../webview-ui/src/thinkingOptions';

describe('thinking options', () => {
  it('根据当前模型 variants 生成选项，而不是固定档位', () => {
    expect(getThinkingOptionsForModel({
      variants: ['minimal', 'low', 'medium', 'high']
    })).toEqual(['off', 'minimal', 'low', 'medium', 'high']);

    expect(getThinkingOptionsForModel({
      variants: ['low', 'max']
    })).toEqual(['off', 'low', 'max']);
  });

  it('没有 variants 但支持 reasoning 时只提供默认 thinking', () => {
    expect(getThinkingOptionsForModel({
      supportsThinking: true
    })).toEqual(['off', 'default']);
  });

  it('不支持 thinking 的模型只显示关闭态', () => {
    expect(getThinkingOptionsForModel({
      supportsThinking: false,
      variants: []
    })).toEqual(['off']);
  });

  it('保留模型内置 none variant，并把 UI off 作为独立关闭开关', () => {
    expect(getThinkingOptionsForModel({
      variants: ['none', 'low', 'medium', 'high', 'xhigh']
    })).toEqual(['off', 'none', 'low', 'medium', 'high', 'xhigh']);
  });

  it('可将选项值映射为 run.start thinking 与 variant 参数', () => {
    expect(getThinkingSelectionValue(false, '')).toBe('off');
    expect(getThinkingSelectionValue(true, '')).toBe('default');
    expect(toThinkingSelection('off')).toEqual({ enabled: false, variant: '' });
    expect(toThinkingSelection('default')).toEqual({ enabled: true, variant: '' });
    expect(toThinkingSelection('max')).toEqual({ enabled: true, variant: 'max' });
    expect(findThinkingOption(['off', 'low', 'max'], 'MAX')).toBe('max');
  });
});
