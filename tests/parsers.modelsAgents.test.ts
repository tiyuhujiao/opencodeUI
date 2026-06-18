import { describe, expect, it } from 'vitest';
import {
  AgentListParseError,
  ModelsListParseError,
  ModelsVerboseParseError,
  parseAgentList,
  parseModelsList,
  parseModelsVerbose
} from '../src/bridge/parsers';

describe('parseModelsList', () => {
  it('可解析轻量 models 列表并拆出 providerID', () => {
    const input = `opencode/big-pickle
google/gemini-2.5-flash

github-copilot/gpt-5.4
`

    expect(parseModelsList(input)).toEqual([
      { modelName: 'opencode/big-pickle', providerID: 'opencode', modelID: 'big-pickle' },
      { modelName: 'google/gemini-2.5-flash', providerID: 'google', modelID: 'gemini-2.5-flash' },
      { modelName: 'github-copilot/gpt-5.4', providerID: 'github-copilot', modelID: 'gpt-5.4' }
    ])
  })

  it('遇到非法模型名时抛 typed error', () => {
    expect(() => parseModelsList('not-a-model-name')).toThrowError(ModelsListParseError)
    expect(() => parseModelsList('not-a-model-name')).toThrow(/非法模型名/)
  })
})

describe('parseModelsVerbose', () => {
  it('可解析多个 model + JSON 区块', () => {
    const input = `opencode/gpt-5-nano
{
  "enabled": true,
  "limits": {
    "rpm": 300
  }
}

opencode/big-pickle
{
  "enabled": false,
  "meta": {
    "provider": "opencode"
  }
}
`;

    const parsed = parseModelsVerbose(input);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      modelName: 'opencode/gpt-5-nano',
      json: {
        enabled: true,
        limits: { rpm: 300 }
      }
    });
    expect(parsed[1]).toEqual({
      modelName: 'opencode/big-pickle',
      json: {
        enabled: false,
        meta: { provider: 'opencode' }
      }
    });
  });

  it('允许多段 provider/model 路径（包含多个 /）', () => {
    const input = `google-vertex/deepseek-ai/deepseek-v3.1-maas
{
  "enabled": true
}
`;

    const parsed = parseModelsVerbose(input);
    expect(parsed).toEqual([
      {
        modelName: 'google-vertex/deepseek-ai/deepseek-v3.1-maas',
        json: {
          enabled: true
        }
      }
    ]);
  });

  it('允许 model 名包含 @', () => {
    const input = `google-vertex-anthropic/claude-3-5-haiku@20241022
{
  "enabled": true
}
`;

    const parsed = parseModelsVerbose(input);
    expect(parsed[0]?.modelName).toBe('google-vertex-anthropic/claude-3-5-haiku@20241022');
  });

  it('JSON 区块非法时抛 typed error', () => {
    const badJson = `opencode/gpt-5-nano
{
  "enabled": true,
}
`;

    expect(() => parseModelsVerbose(badJson)).toThrowError(ModelsVerboseParseError);
    expect(() => parseModelsVerbose(badJson)).toThrow(/JSON 非法/);
  });

  it('缺少 model 行时抛错', () => {
    const missingModelLine = `{
  "enabled": true
}
`;

    expect(() => parseModelsVerbose(missingModelLine)).toThrowError(ModelsVerboseParseError);
    expect(() => parseModelsVerbose(missingModelLine)).toThrow(/不是合法模型名/);
  });
});

describe('parseAgentList', () => {
  it('可解析多个头部并识别 primary，忽略后续 JSON body', () => {
    const input = `build (primary)
  [
    "read",
    "write"
  ]

explore
  [
    {
      "scope": "search"
    }
  ]

librarian
  []
`;

    const parsed = parseAgentList(input);
    expect(parsed).toEqual([
      { name: 'build', isPrimary: true },
      { name: 'explore', isPrimary: false },
      { name: 'librarian', isPrimary: false }
    ]);
  });

  it('允许 body 的结尾 \']\' 行不缩进（应被忽略）', () => {
    const input = `build (primary)
  []
]

explore
  []
`;

    const parsed = parseAgentList(input);
    expect(parsed).toEqual([
      { name: 'build', isPrimary: true },
      { name: 'explore', isPrimary: false }
    ]);
  });

  it('允许 header 带 (subagent) tag（不视为 primary）', () => {
    const input = `build (primary)
  []

explore (subagent)
  []
`;

    const parsed = parseAgentList(input);
    expect(parsed).toEqual([
      { name: 'build', isPrimary: true },
      { name: 'explore', isPrimary: false }
    ]);
  });

  it('非法头部行会抛 typed error', () => {
    const badHeader = `build (primary)
  []
bad header !!!
  []
`;

    expect(() => parseAgentList(badHeader)).toThrowError(AgentListParseError);
    expect(() => parseAgentList(badHeader)).toThrow(/不是合法 agent 头部/);
  });
});
