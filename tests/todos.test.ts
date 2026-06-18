import { describe, expect, it } from 'vitest';
import type { TranscriptMessage } from '../src/shared/protocol';
import {
  countCompletedTodos,
  extractLatestTodosFromTranscript,
  extractTodosFromToolRaw,
  normalizeTodoStatus,
  todoStatusLabel
} from '../webview-ui/src/todos';

describe('webview todo helpers', () => {
  it('uses the newest todowrite part as the visible todo state', () => {
    const messages: TranscriptMessage[] = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool',
            toolName: 'todowrite',
            status: 'completed',
            raw: {
              state: {
                input: {
                  todos: [{ content: 'old task', status: 'pending', priority: 'medium' }]
                }
              }
            }
          }
        ]
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool',
            toolName: 'todowrite',
            status: 'completed',
            raw: {
              state: {
                input: {
                  todos: [
                    { content: 'new task', status: 'in_progress', priority: 'high' },
                    { content: 'done task', status: 'completed', priority: 'low' }
                  ]
                }
              }
            }
          }
        ]
      }
    ];

    expect(extractLatestTodosFromTranscript(messages)).toEqual([
      { content: 'new task', status: 'in_progress', priority: 'high' },
      { content: 'done task', status: 'completed', priority: 'low' }
    ]);
  });

  it('reads runtime, export, and metadata todo payloads', () => {
    expect(
      extractTodosFromToolRaw({
        part: {
          state: {
            input: {
              todos: [{ content: 'runtime task', status: 'doing' }]
            }
          }
        }
      })
    ).toEqual([{ content: 'runtime task', status: 'doing', priority: '' }]);

    expect(
      extractTodosFromToolRaw({
        state: {
          input: {
            todos: [{ content: 'export task', status: 'done', priority: 'high' }]
          }
        }
      })
    ).toEqual([{ content: 'export task', status: 'done', priority: 'high' }]);

    expect(
      extractTodosFromToolRaw({
        state: {
          metadata: {
            todos: [{ content: 'metadata task', status: 'pending' }, { content: '', status: 'pending' }]
          }
        }
      })
    ).toEqual([{ content: 'metadata task', status: 'pending', priority: '' }]);
  });

  it('normalizes todo status aliases for progress summaries', () => {
    const todos = [
      { content: 'a', status: 'complete', priority: '' },
      { content: 'b', status: 'done', priority: '' },
      { content: 'c', status: 'in progress', priority: '' },
      { content: 'd', status: '', priority: '' }
    ];

    expect(countCompletedTodos(todos)).toBe(2);
    expect(normalizeTodoStatus('doing')).toBe('in_progress');
    expect(normalizeTodoStatus('')).toBe('pending');
    expect(todoStatusLabel('in-progress')).toBe('in progress');
  });
});
