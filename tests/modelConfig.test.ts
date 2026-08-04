import { describe, expect, it } from 'vitest';
import { extractConfiguredModelMetadata, extractModelDefinitionMetadata } from '../src/bridge/parsers';

describe('model config metadata', () => {
  it('保留 opencode.json 中 variants 的键顺序并读取 context limit', () => {
    expect(extractModelDefinitionMetadata({
      variants: {
        high: { reasoningEffort: 'high' },
        low: { reasoningEffort: 'low' },
        max: { reasoningEffort: 'max' }
      },
      limit: { context: 200000 }
    })).toEqual({
      variants: ['high', 'low', 'max'],
      contextWindow: 200000
    });
  });

  it('按 provider/model 全名提取配置并过滤空白或重复 variant', () => {
    const models = extractConfiguredModelMetadata({
      provider: {
        cpa: {
          models: {
            'gpt-5': {
              variants: [' medium ', 'LOW', 'low', ''],
              limits: { context: 128000 }
            }
          }
        }
      }
    });

    expect(models.get('cpa/gpt-5')).toEqual({
      variants: ['medium', 'LOW'],
      contextWindow: 128000
    });
  });
});
