import { describe, expect, it } from 'vitest'
import type { TranscriptMessage } from '../src/shared/protocol'
import { summarizeEditedFiles } from '../webview-ui/src/editedFiles'

describe('edited file summaries', () => {
  it('从 edit/write 工具调用中提取文件路径和增删统计', () => {
    const messages: TranscriptMessage[] = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool',
            toolName: 'edit',
            status: 'completed',
            raw: {
              part: {
                id: 'tool-1',
                state: {
                  input: {
                    filePath: 'E:\\opencodeUI\\webview-ui\\src\\App.tsx',
                    oldString: 'old\nline',
                    newString: 'new\nline\nadded'
                  }
                }
              }
            }
          },
          {
            type: 'tool',
            toolName: 'write',
            status: 'completed',
            raw: {
              part: {
                id: 'tool-2',
                state: {
                  input: {
                    path: 'webview-ui/src/styles.css',
                    content: '.run-indicator {}'
                  }
                }
              }
            }
          }
        ]
      }
    ]

    expect(summarizeEditedFiles(messages, 'E:\\opencodeUI')).toEqual([
      {
        path: 'E:\\opencodeUI\\webview-ui\\src\\App.tsx',
        displayPath: 'webview-ui/src/App.tsx',
        additions: 3,
        deletions: 2
      },
      {
        path: 'webview-ui/src/styles.css',
        displayPath: 'webview-ui/src/styles.css',
        additions: 1,
        deletions: 0
      }
    ])
  })

  it('从 unified diff 中按文件统计增删行', () => {
    const messages: TranscriptMessage[] = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool',
            toolName: 'apply_patch',
            status: 'completed',
            raw: {
              part: {
                id: 'patch-1',
                state: {
                  output: [
                    'diff --git a/webview-ui/src/App.tsx b/webview-ui/src/App.tsx',
                    '--- a/webview-ui/src/App.tsx',
                    '+++ b/webview-ui/src/App.tsx',
                    '@@',
                    '+added',
                    '-removed',
                    'diff --git a/tests/runStatusIndicator.test.ts b/tests/runStatusIndicator.test.ts',
                    '--- a/tests/runStatusIndicator.test.ts',
                    '+++ b/tests/runStatusIndicator.test.ts',
                    '@@',
                    '+one',
                    '+two'
                  ].join('\n')
                }
              }
            }
          }
        ]
      }
    ]

    expect(summarizeEditedFiles(messages)).toEqual([
      {
        path: 'webview-ui/src/App.tsx',
        displayPath: 'webview-ui/src/App.tsx',
        additions: 1,
        deletions: 1
      },
      {
        path: 'tests/runStatusIndicator.test.ts',
        displayPath: 'tests/runStatusIndicator.test.ts',
        additions: 2,
        deletions: 0
      }
    ])
  })
})
