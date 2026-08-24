import { describe, expect, it } from 'vitest';
import {
  getActivitySummary,
  type ActivityEntry
} from '../webview-ui/src/components/Transcript';

const t = (source: string) => source;

function reasoning(key: string, text: string): ActivityEntry {
  return { key, part: { type: 'reasoning', text } };
}

function tool(key: string, command: string): ActivityEntry {
  return {
    key,
    part: {
      type: 'tool',
      toolName: 'bash',
      status: 'completed',
      raw: {
        state: {
          status: 'completed',
          input: { command },
          output: 'done'
        }
      }
    }
  };
}

describe('activity summary selection', () => {
  it('switches back to Thinking when reasoning follows a tool', () => {
    const summary = getActivitySummary([
      reasoning('thinking-1', 'Inspect the project'),
      tool('tool-1', 'npm test'),
      reasoning('thinking-2', 'Review the failing assertion')
    ], t);

    expect(summary.current).toBe('Thinking Review the failing assertion');
  });

  it('switches to Tool when a tool follows reasoning', () => {
    const summary = getActivitySummary([
      reasoning('thinking-1', 'Choose a test command'),
      tool('tool-1', 'npm test')
    ], t);

    expect(summary.current).toBe('Tool: npm test');
  });

  it('uses the final item in a grouped tool event even when an earlier subtask is still active', () => {
    const summary = getActivitySummary([
      {
        key: 'tool-group',
        part: {
          type: 'tool',
          toolName: '__tool_group__',
          status: 'group',
          raw: {
            toolGroup: [
              {
                summary: '-> task Analyze architecture',
                toolName: 'task',
                title: 'Analyze architecture',
                status: 'running'
              },
              {
                summary: '-> bash npm test',
                toolName: 'bash',
                title: 'npm test',
                status: 'completed'
              }
            ]
          }
        }
      }
    ], t);

    expect(summary.current).toBe('Tool: npm test');
  });
});
