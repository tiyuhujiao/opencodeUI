import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { __setSpawnImplementationForTests, runStream } from '../src/bridge/opencodeCli';
import { createNdjsonParser, parseRunEvent } from '../src/bridge/parsers';

type TranscriptPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'reasoning';
      text: string;
      raw?: unknown;
    }
  | {
      type: 'tool';
      toolName: string;
      status: string;
      raw: unknown;
    }
  | {
      type: 'unknown';
      raw: unknown;
    };

type TranscriptMessage = {
  role: 'user' | 'assistant' | 'unknown';
  parts: TranscriptPart[];
};

type UiRunEvent =
  | {
      type: 'part';
      part: TranscriptPart;
    }
  | {
      type: 'error';
      error: string;
    }
  | {
      type: 'done' | 'stopped';
    };

class FakeChild {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();

  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  public on(event: string, listener: (...args: unknown[]) => void): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  public once(event: string, listener: (...args: unknown[]) => void): this {
    const wrapped = (...args: unknown[]): void => {
      this.removeListener(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  public removeListener(event: string, listener: (...args: unknown[]) => void): this {
    const list = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      list.filter((item) => item !== listener)
    );
    return this;
  }

  public emit(event: string, ...args: unknown[]): void {
    const list = [...(this.listeners.get(event) ?? [])];
    for (const listener of list) {
      listener(...args);
    }
  }

  public kill(): boolean {
    this.emit('close', 0);
    return true;
  }
}

afterEach(() => {
  __setSpawnImplementationForTests(undefined);
});

describe('run stream integration', () => {
  it('fake spawn NDJSON 事件可驱动 transcript 流式追加', async () => {
    const child = new FakeChild();

    __setSpawnImplementationForTests((() => child as never) as never);

    const run = runStream('hello', {
      model: 'opencode/gpt-5',
      agent: 'build',
      sessionId: 'session-1'
    });

    child.stdout.write('{"type":"text","text":"你"}\n');
    child.stdout.write('{"type":"text","text":"好"}\n');
    child.stdout.write('not-json\n');
    child.stdout.end();
    child.emit('close', 0);

    const parser = createNdjsonParser<unknown>();
    const events: UiRunEvent[] = [];

    for await (const line of run.stdoutLines) {
      for (const parsed of parser.push(`${line}\n`)) {
        if (!parsed.ok) {
          continue;
        }

        const event = parseRunEvent(parsed.value);
        if (event) {
          events.push(event);
        }
      }
    }

    for (const parsed of parser.end()) {
      if (!parsed.ok) {
        continue;
      }
      const event = parseRunEvent(parsed.value);
      if (event) {
        events.push(event);
      }
    }

    await expect(run.completion).resolves.toMatchObject({ exitCode: 0 });
    expect(events).toHaveLength(2);

    const base: TranscriptMessage[] = [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }]
      },
      {
        role: 'assistant',
        parts: []
      }
    ];

    const streamed = events.reduce((acc, event) => applyRunEventToTranscript(acc, event, 1), base);
    expect(streamed[1]?.parts).toEqual([{ type: 'text', text: '你好' }]);
  });

  it('保留流式文本片段中的前后空白', async () => {
    const child = new FakeChild();
    __setSpawnImplementationForTests((() => child as never) as never);

    const run = runStream('hello', {
      model: 'opencode/gpt-5',
      agent: 'build',
      sessionId: 'session-1'
    });

    child.stdout.write('{"type":"text","text":" hello"}\n');
    child.stdout.write('{"type":"text","text":" world "}\n');
    child.stdout.end();
    child.emit('close', 0);

    const parser = createNdjsonParser<unknown>();
    const events: UiRunEvent[] = [];
    for await (const line of run.stdoutLines) {
      for (const parsed of parser.push(`${line}\n`)) {
        if (!parsed.ok) continue;
        const event = parseRunEvent(parsed.value);
        if (event) events.push(event);
      }
    }
    for (const parsed of parser.end()) {
      if (!parsed.ok) continue;
      const event = parseRunEvent(parsed.value);
      if (event) events.push(event);
    }

    await expect(run.completion).resolves.toMatchObject({ exitCode: 0 });

    const base: TranscriptMessage[] = [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }]
      },
      {
        role: 'assistant',
        parts: []
      }
    ];

    const streamed = events.reduce((acc, event) => applyRunEventToTranscript(acc, event, 1), base);
    expect(streamed[1]?.parts).toEqual([{ type: 'text', text: ' hello world ' }]);
  });
});

function applyRunEventToTranscript(messages: TranscriptMessage[], event: UiRunEvent, assistantIndex: number): TranscriptMessage[] {
  const next = [...messages];
  const target = next[assistantIndex];
  if (!target) {
    return next;
  }

  if (event.type === 'part') {
    if (event.part.type === 'text') {
      const previous = target.parts[target.parts.length - 1];
      if (previous?.type === 'text') {
        target.parts[target.parts.length - 1] = {
          type: 'text',
          text: `${previous.text}${event.part.text}`
        };
      } else {
        target.parts.push(event.part);
      }
      return next;
    }

    target.parts.push(event.part);
    return next;
  }

  if (event.type === 'error') {
    target.parts.push({
      type: 'text',
      text: `\n\n运行错误：${event.error}`
    });
  }

  return next;
}
