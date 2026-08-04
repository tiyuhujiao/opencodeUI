import { describe, expect, it } from 'vitest';
import { extractToolEditEvidence } from '../src/inlineDiff/toolEvidence';

describe('inline diff tool evidence', () => {
  it('normalizes nested edit inputs, tool identity, status, and file URIs', () => {
    expect(
      extractToolEditEvidence({
        toolName: 'edit',
        status: 'pending',
        raw: {
          part: {
            id: 'tool-1',
            state: {
              status: 'completed',
              input: {
                filePath: 'file:///E:/opencodeUI/src/extension.ts',
                oldString: 'before',
                newString: 'after'
              }
            }
          }
        }
      })
    ).toEqual([
      expect.objectContaining({
        toolId: 'tool-1',
        toolName: 'edit',
        status: 'completed',
        path: 'E:/opencodeUI/src/extension.ts',
        operation: 'modify',
        source: 'input',
        oldText: 'before',
        newText: 'after',
        replacements: [{ oldText: 'before', newText: 'after' }]
      })
    ]);
  });

  it('collects all replacements from multiedit inputs', () => {
    const [evidence] = extractToolEditEvidence({
      toolName: 'multi-edit',
      status: 'running',
      raw: {
        state: {
          input: {
            path: 'src/file.ts',
            edits: [
              { old_string: 'one', new_string: 'ONE' },
              { oldText: 'two', newText: 'TWO' }
            ]
          }
        }
      }
    });

    expect(evidence).toMatchObject({ status: 'running', path: 'src/file.ts' });
    expect(evidence.replacements).toEqual([
      { oldText: 'one', newText: 'ONE' },
      { oldText: 'two', newText: 'TWO' }
    ]);
  });

  it('splits a multi-file unified diff into normalized file evidence', () => {
    const diff = [
      'diff --git a/src/changed.ts b/src/changed.ts',
      '--- a/src/changed.ts',
      '+++ b/src/changed.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/src/new.ts b/src/new.ts',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1 @@',
      '+created'
    ].join('\n');

    const evidence = extractToolEditEvidence({
      toolName: 'apply_patch',
      status: 'done',
      raw: { part: { id: 'patch-1', state: { output: diff } } }
    });

    expect(evidence).toHaveLength(2);
    expect(evidence[0]).toMatchObject({
      toolId: 'patch-1',
      status: 'completed',
      path: 'src/changed.ts',
      operation: 'modify',
      oldPath: 'src/changed.ts',
      newPath: 'src/changed.ts',
      oldText: 'old',
      newText: 'new'
    });
    expect(evidence[1]).toMatchObject({
      path: 'src/new.ts',
      operation: 'create',
      newPath: 'src/new.ts',
      oldText: '',
      newText: 'created'
    });
  });

  it('parses apply_patch add, update, delete, and move markers', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/old.ts',
      '*** Move to: src/renamed.ts',
      '@@',
      '-old',
      '+new',
      '*** Add File: src/added.ts',
      '+created',
      '*** Delete File: src/deleted.ts',
      '-removed',
      '*** End Patch'
    ].join('\n');

    const evidence = extractToolEditEvidence({
      toolName: 'apply_patch',
      status: 'completed',
      raw: { state: { input: { patch } } }
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        path: 'src/old.ts',
        operation: 'rename',
        oldPath: 'src/old.ts',
        newPath: 'src/renamed.ts',
        oldText: 'old',
        newText: 'new'
      }),
      expect.objectContaining({
        path: 'src/added.ts',
        operation: 'create',
        newPath: 'src/added.ts',
        oldText: '',
        newText: 'created'
      }),
      expect.objectContaining({
        path: 'src/deleted.ts',
        operation: 'delete',
        oldPath: 'src/deleted.ts',
        oldText: 'removed',
        newText: ''
      })
    ]);
  });

  it('ignores non-edit tools and normalizes failed statuses', () => {
    expect(extractToolEditEvidence({ toolName: 'read', status: 'completed', raw: {} })).toEqual([]);
    expect(
      extractToolEditEvidence({
        toolName: 'write',
        status: 'failed',
        raw: { input: { path: 'src/output.ts', content: 'content' } }
      })[0]
    ).toMatchObject({ status: 'error', path: 'src/output.ts', newText: 'content' });
  });
});
