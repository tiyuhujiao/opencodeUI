import { describe, expect, it } from 'vitest';
import {
  ExportJsonParseError,
  parseExportJson,
  parseSessionListJson,
  SessionListJsonParseError
} from '../src/bridge/parsers';

describe('parseSessionListJson', () => {
  it('可解析有效 JSON（允许前后空白）', () => {
    const input = `
      [
        {
          "id": "s-1",
          "title": "Session A",
          "updated": "2026-03-01T00:00:00Z",
          "created": "2026-02-28T00:00:00Z",
          "projectId": "p-1",
          "directory": "/tmp/project"
        }
      ]
    `;

    const sessions = parseSessionListJson(input);
    expect(sessions).toEqual([
      {
        id: 's-1',
        title: 'Session A',
        updated: '2026-03-01T00:00:00Z',
        created: '2026-02-28T00:00:00Z',
        projectId: 'p-1',
        directory: '/tmp/project'
      }
    ]);
  });

  it('updated/created 支持 number 时间戳（毫秒）并规范化为 ISO 字符串', () => {
    const input = JSON.stringify([
      {
        id: 's-1',
        title: 'Session A',
        updated: 1772621952955,
        created: 1772534610421,
        projectId: 'p-1',
        directory: '/tmp/project'
      }
    ]);

    const sessions = parseSessionListJson(input);
    expect(sessions[0]?.updated).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(sessions[0]?.created).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('无效 JSON 会抛出 typed error', () => {
    expect(() => parseSessionListJson('{bad json')).toThrowError(SessionListJsonParseError);
    expect(() => parseSessionListJson('{bad json')).toThrow(/不是合法 JSON/);
  });

  it('可从前后混入文本的输出中提取数组 JSON', () => {
    const input = `warning: using fallback runtime\n[
      {
        "id": "s-1",
        "title": "Session A",
        "updated": "2026-03-01T00:00:00Z",
        "created": "2026-02-28T00:00:00Z",
        "projectId": "p-1",
        "directory": "/tmp/project"
      }
    ]\nextra tail`;

    expect(parseSessionListJson(input)).toHaveLength(1);
  });

  it('缺少必填字段会抛错', () => {
    const missingField = JSON.stringify([
      {
        id: 's-1',
        title: 'Session A',
        updated: '2026-03-01T00:00:00Z',
        created: '2026-02-28T00:00:00Z',
        projectId: 'p-1'
      }
    ]);

    expect(() => parseSessionListJson(missingField)).toThrow(/directory 为必填字段/);
  });
});

describe('parseExportJson', () => {
  it('可解析有效 JSON（允许尾部换行）', () => {
    const input = `${JSON.stringify(
      {
        info: { model: 'gpt' },
        messages: [
          {
            info: { role: 'user' },
            parts: [{ type: 'text', text: 'hello' }]
          }
        ]
      },
      null,
      2
    )}\n\n`;

    const payload = parseExportJson(input);
    expect(payload.info).toEqual({ model: 'gpt' });
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]?.info).toEqual({ role: 'user' });
    expect(payload.messages[0]?.parts).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('无效 JSON 会抛出 typed error', () => {
    expect(() => parseExportJson('{bad json')).toThrowError(ExportJsonParseError);
    expect(() => parseExportJson('{bad json')).toThrow(/不是合法 JSON/);
  });

  it('messages/parts 结构不合法会抛错', () => {
    const messagesNotArray = JSON.stringify({ info: {}, messages: {} });
    expect(() => parseExportJson(messagesNotArray)).toThrow(/messages 必须是数组/);

    const missingParts = JSON.stringify({
      info: {},
      messages: [{ info: { role: 'assistant' } }]
    });
    expect(() => parseExportJson(missingParts)).toThrow(/parts 为必填字段/);
  });
});
