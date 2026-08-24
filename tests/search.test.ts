import { describe, expect, it } from 'vitest';
import type { TranscriptMessage } from '../src/shared/protocol';
import {
  createSearchRegExp,
  createSearchSnippet,
  createSearchSnippetParts,
  findTranscriptMatches,
  getSearchableMessageText
} from '../src/shared/search';

function textMessage(role: 'user' | 'assistant', parts: TranscriptMessage['parts'], id?: string): TranscriptMessage {
  return {
    ...(id ? { id } : {}),
    role,
    parts
  };
}

describe('transcript search', () => {
  it('只搜索 user/assistant 的 text part，并排除 thinking、tool 和 unknown', () => {
    const messages: TranscriptMessage[] = [
      textMessage('user', [{ type: 'text', text: 'refresh token' }], 'user-1'),
      textMessage('assistant', [
        { type: 'reasoning', text: 'refresh token in thinking' },
        { type: 'tool', toolName: 'grep', status: 'completed', raw: { output: 'refresh token in tool' } },
        { type: 'unknown', raw: 'refresh token in unknown' },
        { type: 'text', text: 'the refresh token is rotated' }
      ], 'assistant-1'),
      textMessage('unknown', [{ type: 'text', text: 'refresh token in unknown message' }], 'unknown-1')
    ];

    const matches = findTranscriptMatches(messages, 'refresh token');

    expect(matches.map((match) => ({ messageIndex: match.messageIndex, role: match.role, occurrence: match.messageOccurrence }))).toEqual([
      { messageIndex: 0, role: 'user', occurrence: 0 },
      { messageIndex: 1, role: 'assistant', occurrence: 0 }
    ]);
    expect(getSearchableMessageText(messages[1]!)).toBe('the refresh token is rotated');
  });

  it('把同一消息的多个 text part 视为连续模型输出', () => {
    const messages = [textMessage('assistant', [
      { type: 'text', text: 'ref' },
      { type: 'text', text: 'resh token rotation' }
    ], 'assistant-1')];

    const matches = findTranscriptMatches(messages, 'refresh token');

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      messageIndex: 0,
      partIndex: 0,
      messageOccurrence: 0,
      text: 'refresh token',
      start: 0,
      end: 13
    });
  });

  it('支持大小写、全字、正则和多个匹配选项', () => {
    const messages = [textMessage('user', [{ type: 'text', text: 'Token token tokenizer' }])];

    expect(findTranscriptMatches(messages, 'token').map((match) => match.text)).toEqual(['Token', 'token', 'token']);
    expect(findTranscriptMatches(messages, 'token', { caseSensitive: true }).map((match) => match.text)).toEqual(['token', 'token']);
    expect(findTranscriptMatches(messages, 'token', { wholeWord: true }).map((match) => match.text)).toEqual(['Token', 'token']);
    expect(findTranscriptMatches(messages, 'tok\\w+', { regex: true }).map((match) => match.text)).toEqual(['Token', 'token', 'tokenizer']);
    expect(createSearchRegExp('[', { regex: true })).toBeNull();
  });

  it('限制最大命中数量并生成带上下文的摘要', () => {
    const messages = [textMessage('assistant', [{ type: 'text', text: 'x x x x' }])];
    const longText = 'prefix '.repeat(40) + 'needle' + ' suffix'.repeat(40);
    const snippet = createSearchSnippetParts(longText, 280, 286, 80);

    expect(findTranscriptMatches(messages, 'x', {}, 2)).toHaveLength(2);
    expect(createSearchSnippet(longText, 280, 286, 80)).toContain('needle');
    expect(snippet.text.slice(snippet.matchStart, snippet.matchEnd)).toBe('needle');
    expect(snippet.matchStart).toBeLessThanOrEqual(33);
  });
});
