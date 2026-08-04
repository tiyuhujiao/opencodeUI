import { describe, expect, it } from 'vitest';
import {
  InlineDiffConflictError,
  applyAcceptHunkToBaseline,
  applyRejectHunkToCurrent,
  buildHunks,
  createTextSnapshot
} from '../src/inlineDiff/core';

describe('inline diff core', () => {
  it('builds stable insertion, deletion, and replacement hunks', () => {
    const inserted = buildHunks('alpha\ngamma\n', 'alpha\nbeta\ngamma\n');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      kind: 'insert',
      beforeStartLine: 1,
      beforeEndLine: 1,
      afterStartLine: 1,
      afterEndLine: 2,
      beforeText: '',
      afterText: 'beta\n',
      additions: 1,
      deletions: 0
    });
    expect(buildHunks('alpha\ngamma\n', 'alpha\nbeta\ngamma\n')[0].id).toBe(inserted[0].id);

    expect(buildHunks('alpha\nbeta\ngamma\n', 'alpha\ngamma\n')[0]).toMatchObject({
      kind: 'delete',
      beforeStartLine: 1,
      beforeEndLine: 2,
      afterStartLine: 1,
      afterEndLine: 1,
      beforeText: 'beta\n',
      afterText: '',
      additions: 0,
      deletions: 1
    });

    expect(buildHunks('alpha\nbeta\n', 'alpha\ndelta\n')[0]).toMatchObject({
      kind: 'replace',
      beforeStartLine: 1,
      beforeEndLine: 2,
      afterStartLine: 1,
      afterEndLine: 2,
      beforeText: 'beta',
      afterText: 'delta',
      additions: 1,
      deletions: 1
    });
  });

  it('accepts a hunk into the baseline and rejects it from current text', () => {
    const baseline = createTextSnapshot('one\ntwo\nthree\n');
    const current = createTextSnapshot('one\nchanged\nthree\n');
    const [hunk] = buildHunks(baseline, current);

    expect(applyAcceptHunkToBaseline(baseline, current, hunk).text).toBe(current.text);
    expect(applyRejectHunkToCurrent(baseline, current, hunk).text).toBe(baseline.text);
  });

  it('preserves CRLF and ignores EOL-only changes', () => {
    expect(buildHunks('one\r\ntwo\r\n', 'one\ntwo\n')).toEqual([]);

    const baseline = createTextSnapshot('one\r\ntwo\r\n');
    const current = createTextSnapshot('one\r\nchanged\r\n');
    const [hunk] = buildHunks(baseline, current);
    expect(hunk.beforeText).toBe('two');
    expect(hunk.afterText).toBe('changed');
    expect(applyRejectHunkToCurrent(baseline, current, hunk)).toMatchObject({
      text: 'one\r\ntwo\r\n',
      eol: '\r\n',
      hasFinalNewline: true
    });
  });

  it('models final newline and empty-file changes without losing bytes', () => {
    const noFinalNewline = createTextSnapshot('value');
    const withFinalNewline = createTextSnapshot('value\n');
    const [newlineHunk] = buildHunks(noFinalNewline, withFinalNewline);
    expect(newlineHunk).toMatchObject({ beforeText: '', afterText: '\n', additions: 0, deletions: 0 });
    expect(applyAcceptHunkToBaseline(noFinalNewline, withFinalNewline, newlineHunk).text).toBe('value\n');
    expect(applyRejectHunkToCurrent(noFinalNewline, withFinalNewline, newlineHunk).text).toBe('value');

    const empty = createTextSnapshot('');
    const created = createTextSnapshot('first\nsecond');
    const [createHunk] = buildHunks(empty, created);
    expect(createHunk).toMatchObject({ kind: 'insert', beforeText: '', afterText: 'first\nsecond' });
    expect(applyRejectHunkToCurrent(empty, created, createHunk).text).toBe('');

    expect(createTextSnapshot('')).toMatchObject({ lineCount: 0, hasFinalNewline: false });
    expect(createTextSnapshot('\r\n')).toMatchObject({ lineCount: 1, eol: '\r\n', hasFinalNewline: true });
  });

  it('merges nearby changes but keeps distant changes independently reviewable', () => {
    const baseline = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].join('\n');
    const current = ['A', 'b', 'c', 'D', 'e', 'f', 'g', 'h', 'I'].join('\n');

    expect(buildHunks(baseline, current)).toHaveLength(2);
    expect(buildHunks(baseline, current, { mergeDistance: 0 })).toHaveLength(3);
  });

  it('falls back to a whole-document hunk when the edit-distance budget is exceeded', () => {
    const [hunk] = buildHunks('a\nb\nc', 'x\ny\nz', { maxEditDistance: 1 });
    expect(hunk).toMatchObject({
      kind: 'replace',
      beforeStartOffset: 0,
      beforeEndOffset: 5,
      afterStartOffset: 0,
      afterEndOffset: 5,
      additions: 3,
      deletions: 3
    });
  });

  it('fails closed when a hunk is stale or has been tampered with', () => {
    const baseline = createTextSnapshot('old');
    const current = createTextSnapshot('new');
    const [hunk] = buildHunks(baseline, current);

    expect(() => applyRejectHunkToCurrent(baseline, createTextSnapshot('user edit'), hunk)).toThrowError(
      expect.objectContaining<Partial<InlineDiffConflictError>>({ code: 'STALE_DOCUMENT' })
    );
    expect(() => applyAcceptHunkToBaseline(baseline, current, { ...hunk, beforeText: 'tampered' })).toThrowError(
      expect.objectContaining<Partial<InlineDiffConflictError>>({ code: 'INVALID_HUNK' })
    );
  });
});
