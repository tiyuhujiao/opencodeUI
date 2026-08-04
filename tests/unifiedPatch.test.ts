import { describe, expect, it } from 'vitest';
import { UnifiedPatchError, reverseUnifiedPatch } from '../src/inlineDiff/unifiedPatch';

describe('OpenCode unified patch reversal', () => {
  it('reconstructs the baseline of a modified file', () => {
    const result = reverseUnifiedPatch(
      'alpha\ndelta\ngamma\n',
      [
        'Index: src/app.txt',
        '===================================================================',
        '--- src/app.txt',
        '+++ src/app.txt',
        '@@ -1,3 +1,3 @@',
        ' alpha',
        '-beta',
        '+delta',
        ' gamma',
        ''
      ].join('\n'),
      { currentExists: true }
    );

    expect(result).toEqual({
      beforeText: 'alpha\nbeta\ngamma\n',
      beforeExists: true,
      afterExists: true
    });
  });

  it('reconstructs created and deleted files', () => {
    const created = reverseUnifiedPatch(
      'first\nsecond\n',
      [
        '--- /dev/null',
        '+++ created.txt',
        '@@ -0,0 +1,2 @@',
        '+first',
        '+second',
        ''
      ].join('\n'),
      { currentExists: true }
    );
    expect(created).toEqual({ beforeText: '', beforeExists: false, afterExists: true });

    const deleted = reverseUnifiedPatch(
      '',
      [
        '--- deleted.txt',
        '+++ /dev/null',
        '@@ -1,2 +0,0 @@',
        '-first',
        '-second',
        ''
      ].join('\n'),
      { currentExists: false }
    );
    expect(deleted).toEqual({
      beforeText: 'first\nsecond\n',
      beforeExists: true,
      afterExists: false
    });
  });

  it('preserves CRLF and final-newline state from the current file', () => {
    const crlf = reverseUnifiedPatch(
      'one\r\nchanged\r\n',
      [
        '--- file.txt',
        '+++ file.txt',
        '@@ -1,2 +1,2 @@',
        ' one',
        '-two',
        '+changed',
        ''
      ].join('\n'),
      { currentExists: true }
    );
    expect(crlf.beforeText).toBe('one\r\ntwo\r\n');

    const noFinalNewline = reverseUnifiedPatch(
      'new',
      [
        '--- file.txt',
        '+++ file.txt',
        '@@ -1 +1 @@',
        '-old',
        '\\ No newline at end of file',
        '+new',
        '\\ No newline at end of file',
        ''
      ].join('\n'),
      { currentExists: true }
    );
    expect(noFinalNewline.beforeText).toBe('old');
  });

  it('fails closed when the patch does not match current workspace content', () => {
    expect(() => reverseUnifiedPatch(
      'user-edited\n',
      [
        '--- file.txt',
        '+++ file.txt',
        '@@ -1 +1 @@',
        '-old',
        '+expected',
        ''
      ].join('\n'),
      { currentExists: true }
    )).toThrowError(UnifiedPatchError);
  });
});
