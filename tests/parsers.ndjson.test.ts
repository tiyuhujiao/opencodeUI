import { describe, expect, it } from 'vitest';
import { createNdjsonParser } from '../src/bridge/parsers';

describe('createNdjsonParser', () => {
  it('可跨 chunk 边界解析多行 JSON', () => {
    const parser = createNdjsonParser<{ id: number }>();

    const out1 = parser.push('{"id":1}\n{"id"');
    const out2 = parser.push(':2}\n{"id":3}');
    const out3 = parser.end();

    expect(out1).toEqual([{ ok: true, value: { id: 1 } }]);
    expect(out2).toEqual([{ ok: true, value: { id: 2 } }]);
    expect(out3).toEqual([{ ok: true, value: { id: 3 } }]);
  });

  it('支持 CRLF 并忽略空行', () => {
    const parser = createNdjsonParser<{ n: number }>();

    const out = parser.push('{"n":1}\r\n\r\n{"n":2}\r\n');
    const ended = parser.end();

    expect(out).toEqual([
      { ok: true, value: { n: 1 } },
      { ok: true, value: { n: 2 } }
    ]);
    expect(ended).toEqual([]);
  });

  it('坏行输出 ok:false 且不中断后续解析', () => {
    const parser = createNdjsonParser<{ ok: boolean }>();

    const out = parser.push('{"ok":true}\nnot-json\n{"ok":false}\n');

    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ ok: true, value: { ok: true } });

    expect(out[1]?.ok).toBe(false);
    if (out[1] && out[1].ok === false) {
      expect(out[1].line).toBe('not-json');
      expect(out[1].error.message).toBe('NDJSON 行不是合法 JSON');
    }

    expect(out[2]).toEqual({ ok: true, value: { ok: false } });
  });

  it('end() 会 flush 无换行结尾的最后一行', () => {
    const parser = createNdjsonParser<{ tail: number }>();

    const out = parser.push('{"tail":9}');
    const ended = parser.end();

    expect(out).toEqual([]);
    expect(ended).toEqual([{ ok: true, value: { tail: 9 } }]);
  });
});
