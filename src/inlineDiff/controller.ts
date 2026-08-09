import * as path from 'node:path';
import * as vscode from 'vscode';
import type { RunStreamEvent, TranscriptPartTool } from '../shared/protocol';
import {
  InlineDiffConflictError,
  applyAcceptHunkToBaseline,
  applyRejectHunkToCurrent,
  buildHunks,
  createTextSnapshot,
  hashText,
  type ReviewHunk,
  type TextSnapshot
} from './core';
import { InlineDiffEditorAdapter, type EditorReviewFile } from './editorAdapter';
import {
  extractToolEditEvidence,
  isEditToolName,
  type ToolEvidenceStatus,
  type ToolTextReplacement
} from './toolEvidence';
import { reverseUnifiedPatch } from './unifiedPatch';
import type {
  InlineDiffController,
  InlineDiffControllerOptions,
  InlineDiffErrorCode,
  InlineDiffFileStatus,
  InlineDiffResolveInput,
  InlineDiffResult,
  InlineDiffRun,
  InlineDiffRunInput,
  InlineDiffRunOutcome,
  InlineDiffSnapshot
} from './types';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_RUN_BYTES = 20 * 1024 * 1024;
const SESSION_DIFF_DELAYS_MS = [0, 100, 300, 700];
const FILE_RECONCILE_DELAYS_MS = [0, 40, 120];

type FileReview = EditorReviewFile & {
  baseline: TextSnapshot;
  current: TextSnapshot;
  runId?: string;
};

type SnapshotRead =
  | { ok: true; exists: boolean; snapshot: TextSnapshot; dirty: boolean }
  | { ok: false; reason: string };

type RunEvidence = {
  uri: vscode.Uri;
  displayPath: string;
  before: Promise<SnapshotRead>;
  operation: 'modify' | 'create' | 'delete' | 'rename' | 'unknown';
  status: ToolEvidenceStatus;
  oldText?: string;
  newText?: string;
  replacements: ToolTextReplacement[];
  unifiedDiff?: string;
  version: number;
  publishedVersion: number;
};

type RunState = {
  input: InlineDiffRunInput;
  evidence: Map<string, RunEvidence>;
  reconcileQueue: Promise<void>;
  reviewBytes: Map<string, number>;
  openedFirstReview: boolean;
  finished: boolean;
  closed: boolean;
};

type ReviewCandidate = {
  uri: vscode.Uri;
  displayPath: string;
  baseline: TextSnapshot;
  current: TextSnapshot;
  baselineExists: boolean;
  currentExists: boolean;
  status: InlineDiffFileStatus;
  reason?: string;
  canonical: boolean;
};

type CanonicalDiff = {
  path: string;
  patchText?: string;
  beforeText?: string;
  afterText?: string;
  beforeExists?: boolean;
  afterExists?: boolean;
};

class InlineDiffControllerImpl implements InlineDiffController {
  private readonly files = new Map<string, FileReview>();
  private readonly fileIdByUri = new Map<string, string>();
  private readonly changeEmitter = new vscode.EventEmitter<InlineDiffSnapshot>();
  private readonly editor: InlineDiffEditorAdapter;
  private readonly activeRuns = new Set<string>();
  private readonly internalChanges = new Set<string>();
  private snapshotRevision = 0;
  private disposed = false;

  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly options: InlineDiffControllerOptions) {
    this.editor = new InlineDiffEditorAdapter({
      getFile: (fileId) => this.files.get(fileId),
      getFileForUri: (uri) => this.getFileForUri(uri),
      listFiles: () => [...this.files.values()],
      isReviewPaused: () => this.activeRuns.size > 0,
      resolve: (input) => this.resolve(input),
      dismiss: (fileId) => this.dismiss(fileId),
      onExternalDocumentChange: (uri) => this.handleExternalDocumentChange(uri),
      isInternalDocumentChange: (uri) => this.internalChanges.has(uriKey(uri)),
      virtualDocumentScheme: options.virtualDocumentScheme,
      commandPrefix: options.commandPrefix
    });
  }

  beginRun(input: InlineDiffRunInput): InlineDiffRun {
    const state: RunState = {
      input,
      evidence: new Map(),
      reconcileQueue: Promise.resolve(),
      reviewBytes: new Map(),
      openedFirstReview: false,
      finished: false,
      closed: false
    };
    this.activeRuns.add(input.runId);
    this.publish();

    return {
      observe: (event) => {
        try {
          this.observeRunEvent(state, event);
        } catch (error) {
          this.log('warn', `inline diff observe failed: ${errorMessage(error)}`);
        }
      },
      finish: async (outcome) => {
        if (state.finished) {
          return;
        }
        state.finished = true;
        try {
          await state.reconcileQueue;
          await this.finishRun(state, outcome);
        } catch (error) {
          this.log('error', `inline diff finish failed: ${errorMessage(error)}`);
        } finally {
          state.closed = true;
          this.activeRuns.delete(input.runId);
          this.publish();
        }
      }
    };
  }

  async open(fileId: string): Promise<InlineDiffResult> {
    try {
      const opened = await this.editor.openNativeDiff(fileId);
      return opened ? this.success() : this.failure('FILE_NOT_FOUND', 'This inline diff review no longer exists.');
    } catch (error) {
      return this.failure('INTERNAL_ERROR', `Unable to open inline diff: ${errorMessage(error)}`);
    }
  }

  async resolve(input: InlineDiffResolveInput): Promise<InlineDiffResult> {
    if (this.activeRuns.size > 0) {
      return this.failure('RUN_ACTIVE', 'Wait for the current OpenCode run to finish before reviewing changes.');
    }
    const file = this.files.get(input.fileId);
    if (!file) {
      return this.failure('FILE_NOT_FOUND', 'This inline diff review no longer exists.');
    }
    if (file.status !== 'pending') {
      return this.failure('REVIEW_UNAVAILABLE', file.reason ?? 'This file can no longer be safely reviewed.');
    }
    if (file.revision !== input.revision) {
      return this.markStale(file, 'The document changed after these review actions were created.');
    }

    const disk = await this.readSnapshot(file.uri);
    if (!disk.ok || disk.exists !== file.currentExists || disk.snapshot.hash !== file.current.hash) {
      return this.markStale(file, disk.ok ? 'The document changed outside the inline diff review.' : disk.reason);
    }

    try {
      if (input.decision === 'accept') {
        return this.accept(file, input.hunkId);
      }
      return await this.reject(file, input.hunkId);
    } catch (error) {
      if (error instanceof InlineDiffConflictError) {
        return this.markStale(file, error.message);
      }
      return this.failure('INTERNAL_ERROR', `Unable to update inline diff: ${errorMessage(error)}`);
    }
  }

  dismiss(fileId: string): void {
    const file = this.files.get(fileId);
    if (!file) {
      return;
    }
    this.files.delete(fileId);
    this.fileIdByUri.delete(uriKey(file.uri));
    this.publish();
  }

  invalidateAll(reason: string): void {
    for (const file of this.files.values()) {
      file.status = 'stale';
      file.reason = reason;
      file.revision += 1;
    }
    this.publish();
  }

  getSnapshot(): InlineDiffSnapshot {
    return {
      revision: this.snapshotRevision,
      activeRun: this.activeRuns.size > 0,
      files: [...this.files.values()]
        .map((file) => ({
          fileId: file.fileId,
          uri: file.uri.toString(),
          path: file.uri.fsPath,
          displayPath: file.displayPath,
          revision: file.revision,
          status: file.status,
          reason: file.reason,
          hunkCount: file.hunks.length,
          additions: file.hunks.reduce((sum, hunk) => sum + hunk.additions, 0),
          deletions: file.hunks.reduce((sum, hunk) => sum + hunk.deletions, 0)
        }))
        .sort((left, right) => left.displayPath.localeCompare(right.displayPath))
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.editor.dispose();
    this.changeEmitter.dispose();
    this.files.clear();
    this.fileIdByUri.clear();
    this.activeRuns.clear();
  }

  private observeRunEvent(state: RunState, event: RunStreamEvent): void {
    if (state.finished || event.type !== 'part' || event.part.type !== 'tool' || !isEditTool(event.part)) {
      return;
    }
    for (const evidence of extractEvidence(event.part, state.input.cwd)) {
      const key = uriKey(evidence.uri);
      const existing = state.evidence.get(key);
      if (existing) {
        existing.oldText ??= evidence.oldText;
        existing.newText ??= evidence.newText;
        existing.unifiedDiff ??= evidence.unifiedDiff;
        for (const replacement of evidence.replacements) {
          if (!existing.replacements.some((item) => item.oldText === replacement.oldText && item.newText === replacement.newText)) {
            existing.replacements.push(replacement);
          }
        }
        if (existing.operation === 'unknown') {
          existing.operation = evidence.operation;
        }
        existing.status = evidence.status;
        existing.version += 1;
        if (evidence.status === 'completed') {
          this.queueEvidenceReconcile(state, key, existing);
        }
        continue;
      }
      const next: RunEvidence = {
        ...evidence,
        before: this.readSnapshot(evidence.uri),
        version: 1,
        publishedVersion: 0
      };
      state.evidence.set(key, next);
      if (evidence.status === 'completed') {
        this.queueEvidenceReconcile(state, key, next);
      }
    }
  }

  private queueEvidenceReconcile(state: RunState, key: string, evidence: RunEvidence): void {
    const version = evidence.version;
    state.reconcileQueue = state.reconcileQueue
      .then(async () => {
        if (this.disposed || state.closed || evidence.publishedVersion >= version) {
          return;
        }
        await this.reconcileCompletedEvidence(state, key, evidence);
        evidence.publishedVersion = Math.max(evidence.publishedVersion, version);
      })
      .catch((error) => {
        this.log('warn', `inline diff file reconcile failed: ${errorMessage(error)}`);
      });
  }

  private async reconcileCompletedEvidence(state: RunState, key: string, evidence: RunEvidence): Promise<void> {
    let candidates: ReviewCandidate[] = [];
    for (const delayMs of FILE_RECONCILE_DELAYS_MS) {
      if (delayMs > 0) {
        await delay(delayMs);
      }
      if (this.disposed || state.closed) {
        return;
      }
      candidates = await this.candidatesFromEvidence(new Map([[key, evidence]]));
      if (candidates.length > 0) {
        break;
      }
    }
    if (candidates.length === 0 || this.disposed || state.closed) {
      return;
    }

    for (const candidate of candidates) {
      this.upsertRunCandidate(state, candidate);
    }
    this.publish();
    await this.openFirstPendingReview(state, candidates);
  }

  private async finishRun(state: RunState, outcome: InlineDiffRunOutcome): Promise<void> {
    const canonical = await this.loadCanonicalDiff(state.input);
    const candidates = canonical.length > 0
      ? await this.candidatesFromCanonical(canonical, state.input.cwd)
      : await this.candidatesFromEvidence(state.evidence);

    state.reviewBytes.clear();
    for (const candidate of candidates) {
      this.upsertRunCandidate(state, candidate);
    }
    await this.openFirstPendingReview(state, candidates);
    this.log('info', `inline diff run ${state.input.runId} (${outcome}) produced ${candidates.length} review candidate(s)`);
  }

  private upsertRunCandidate(state: RunState, candidate: ReviewCandidate): void {
    const key = uriKey(candidate.uri);
    const bytes = Buffer.byteLength(candidate.baseline.text, 'utf8') + Buffer.byteLength(candidate.current.text, 'utf8');
    const previousBytes = state.reviewBytes.get(key) ?? 0;
    const nextTotal = [...state.reviewBytes.values()].reduce((sum, value) => sum + value, 0) - previousBytes + bytes;
    state.reviewBytes.set(key, bytes);
    if (nextTotal > MAX_RUN_BYTES) {
      this.upsertUnavailable(candidate, 'The inline diff snapshot budget for this run exceeded 20 MiB.', state.input.runId);
      return;
    }
    this.upsertCandidate(candidate, state.input.runId);
  }

  private async openFirstPendingReview(state: RunState, candidates: ReviewCandidate[]): Promise<void> {
    if (state.openedFirstReview || this.disposed || state.closed) {
      return;
    }
    const firstPending = candidates
      .map((candidate) => this.getFileForUri(candidate.uri))
      .find((file) => file?.status === 'pending');
    if (firstPending && await this.editor.openNativeDiff(firstPending.fileId)) {
      state.openedFirstReview = true;
    }
  }

  private async loadCanonicalDiff(input: InlineDiffRunInput): Promise<CanonicalDiff[]> {
    let messageId: string | undefined;
    try {
      const messages = await this.options.requestServeJson<unknown>(
        `/session/${encodeURIComponent(input.sessionId)}/message`
      );
      messageId = findRunUserMessageId(messages, input.startedAt, input.promptText);
    } catch (error) {
      this.log('warn', `inline diff message lookup failed: ${errorMessage(error)}`);
    }

    const pathname = `/session/${encodeURIComponent(input.sessionId)}/diff${
      messageId ? `?messageID=${encodeURIComponent(messageId)}` : ''
    }`;
    for (const delayMs of SESSION_DIFF_DELAYS_MS) {
      if (delayMs > 0) {
        await delay(delayMs);
      }
      try {
        const response = await this.options.requestServeJson<unknown>(pathname);
        const parsed = normalizeCanonicalDiff(response);
        if (parsed.length > 0) {
          return parsed;
        }
      } catch (error) {
        this.log('warn', `inline diff endpoint attempt failed: ${errorMessage(error)}`);
      }
    }
    return [];
  }

  private async candidatesFromCanonical(items: CanonicalDiff[], cwd: string): Promise<ReviewCandidate[]> {
    const candidates: ReviewCandidate[] = [];
    for (const item of items) {
      const uri = resolveFileUri(item.path, cwd);
      const displayPath = displayPathForUri(uri);
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
      if (!workspaceFolder) {
        candidates.push(unavailableCandidate(uri, displayPath, 'The changed file is outside the current workspace.'));
        continue;
      }
      const actual = await this.readSnapshot(uri);
      if (!actual.ok) {
        candidates.push(unavailableCandidate(uri, displayPath, actual.reason));
        continue;
      }
      if (item.patchText) {
        try {
          const reversed = reverseUnifiedPatch(actual.snapshot.text, item.patchText, { currentExists: actual.exists });
          candidates.push({
            uri,
            displayPath,
            baseline: createTextSnapshot(reversed.beforeText),
            current: actual.snapshot,
            baselineExists: reversed.beforeExists,
            currentExists: reversed.afterExists,
            status: actual.dirty ? 'stale' : 'pending',
            reason: actual.dirty ? 'The document has unsaved changes, so Reject is disabled.' : undefined,
            canonical: true
          });
        } catch (error) {
          candidates.push({
            uri,
            displayPath,
            baseline: actual.snapshot,
            current: actual.snapshot,
            baselineExists: actual.exists,
            currentExists: actual.exists,
            status: 'unavailable',
            reason: `OpenCode returned a patch that could not be matched safely: ${errorMessage(error)}`,
            canonical: true
          });
        }
        continue;
      }

      const beforeText = item.beforeText ?? '';
      const afterText = item.afterText ?? '';
      const beforeExists = item.beforeExists ?? true;
      const afterExists = item.afterExists ?? true;
      const baseline = createTextSnapshot(beforeText);
      const endpointAfter = createTextSnapshot(afterText);
      const actualMatches = actual.exists === afterExists && actual.snapshot.hash === endpointAfter.hash;
      candidates.push({
        uri,
        displayPath,
        baseline,
        current: actual.snapshot,
        baselineExists: beforeExists,
        currentExists: actual.exists,
        status: actual.dirty || !actualMatches ? 'stale' : 'pending',
        reason: actual.dirty
          ? 'The document has unsaved changes, so Reject is disabled.'
          : !actualMatches
            ? 'The file changed after OpenCode reported its diff.'
            : undefined,
        canonical: true
      });
    }
    return candidates;
  }

  private async candidatesFromEvidence(evidenceByUri: Map<string, RunEvidence>): Promise<ReviewCandidate[]> {
    const candidates: ReviewCandidate[] = [];
    for (const evidence of evidenceByUri.values()) {
      const before = await evidence.before;
      const current = await this.readSnapshot(evidence.uri);
      if (!before.ok || !current.ok) {
        candidates.push(unavailableCandidate(evidence.uri, evidence.displayPath, !before.ok ? before.reason : current.ok ? '' : current.reason));
        continue;
      }
      let baseline = before.snapshot;
      let baselineExists = before.exists;
      if (evidence.operation === 'rename') {
        candidates.push(unavailableCandidate(evidence.uri, evidence.displayPath, 'Rename review is unavailable without a canonical OpenCode session diff.'));
        continue;
      }
      if (baseline.hash === current.snapshot.hash && baselineExists === current.exists) {
        if (evidence.unifiedDiff) {
          try {
            const reversed = reverseUnifiedPatch(current.snapshot.text, evidence.unifiedDiff, { currentExists: current.exists });
            baseline = createTextSnapshot(reversed.beforeText);
            baselineExists = reversed.beforeExists;
          } catch {
            // Fall through to the more conservative tool-input reconstruction below.
          }
        }
        if (baseline.hash !== current.snapshot.hash || baselineExists !== current.exists) {
          // The unified diff reconstructed a usable baseline.
        } else if (evidence.operation === 'create' && evidence.newText === current.snapshot.text) {
          baseline = createTextSnapshot('');
          baselineExists = false;
        } else if (evidence.operation === 'delete' && !current.exists && evidence.oldText !== undefined) {
          baseline = createTextSnapshot(evidence.oldText);
          baselineExists = true;
        } else if (evidence.replacements.length > 0) {
          const reconstructed = reverseReplacements(current.snapshot.text, evidence.replacements);
          if (reconstructed !== undefined) {
            baseline = createTextSnapshot(reconstructed);
            baselineExists = true;
          }
        } else if (evidence.oldText !== undefined && evidence.newText !== undefined) {
          const reconstructed = reverseSingleReplacement(current.snapshot.text, evidence.oldText, evidence.newText);
          if (reconstructed !== undefined) {
            baseline = createTextSnapshot(reconstructed);
            baselineExists = true;
          }
        }
      }
      if (baseline.hash === current.snapshot.hash && baselineExists === current.exists) {
        continue;
      }
      candidates.push({
        uri: evidence.uri,
        displayPath: evidence.displayPath,
        baseline,
        current: current.snapshot,
        baselineExists,
        currentExists: current.exists,
        status: before.dirty || current.dirty ? 'unavailable' : 'pending',
        reason: before.dirty || current.dirty ? 'The document had unsaved changes while OpenCode was editing it.' : undefined,
        canonical: false
      });
    }
    return candidates;
  }

  private upsertCandidate(candidate: ReviewCandidate, runId?: string): void {
    const key = uriKey(candidate.uri);
    const existingId = this.fileIdByUri.get(key);
    const existing = existingId ? this.files.get(existingId) : undefined;
    let baseline = candidate.baseline;
    let baselineExists = candidate.baselineExists;
    let status = candidate.status;
    let reason = candidate.reason;

    if (existing?.status === 'pending') {
      if (runId && existing.runId === runId) {
        if (!candidate.canonical) {
          baseline = existing.baseline;
          baselineExists = existing.baselineExists;
        }
      } else if (existing.current.hash === candidate.baseline.hash && existing.currentExists === candidate.baselineExists) {
        baseline = existing.baseline;
        baselineExists = existing.baselineExists;
      } else {
        status = 'stale';
        reason = 'A later OpenCode run started from content that no longer matches this pending review.';
      }
    }

    const hunks = buildHunks(baseline, candidate.current);
    if (candidate.status !== 'unavailable' && hunks.length === 0 && baselineExists === candidate.currentExists) {
      if (existing) {
        this.files.delete(existing.fileId);
        this.fileIdByUri.delete(key);
      }
      return;
    }

    const fileId = existing?.fileId ?? `file-${hashText(key)}`;
    const review: FileReview = {
      fileId,
      uri: candidate.uri,
      displayPath: candidate.displayPath,
      revision: (existing?.revision ?? 0) + 1,
      status,
      reason,
      baselineText: baseline.text,
      currentText: candidate.current.text,
      baselineExists,
      currentExists: candidate.currentExists,
      baseline,
      current: candidate.current,
      runId: runId ?? existing?.runId,
      hunks
    };
    this.files.set(fileId, review);
    this.fileIdByUri.set(key, fileId);
  }

  private upsertUnavailable(candidate: ReviewCandidate, reason: string, runId?: string): void {
    const unavailable = { ...candidate, status: 'unavailable' as const, reason };
    this.upsertCandidate(unavailable, runId);
  }

  private accept(file: FileReview, hunkId: string | undefined): InlineDiffResult {
    if (!hunkId) {
      this.files.delete(file.fileId);
      this.fileIdByUri.delete(uriKey(file.uri));
      this.publish();
      return this.success();
    }
    const hunk = file.hunks.find((item) => item.id === hunkId);
    if (!hunk) {
      return this.markStale(file, 'This hunk no longer exists in the current document revision.');
    }
    file.baseline = applyAcceptHunkToBaseline(file.baseline, file.current, hunk);
    file.baselineText = file.baseline.text;
    file.hunks = buildHunks(file.baseline, file.current);
    file.revision += 1;
    if (file.hunks.length === 0) {
      file.baselineExists = file.currentExists;
      this.files.delete(file.fileId);
      this.fileIdByUri.delete(uriKey(file.uri));
    }
    this.publish();
    return this.success();
  }

  private async reject(file: FileReview, hunkId: string | undefined): Promise<InlineDiffResult> {
    const next = hunkId
      ? this.rejectHunkSnapshot(file, hunkId)
      : { snapshot: file.baseline, exists: file.baselineExists };
    if (!next) {
      return this.markStale(file, 'This hunk no longer exists in the current document revision.');
    }
    const applied = await this.applySnapshot(file, next.snapshot, next.exists);
    if (!applied.ok) {
      return applied.result;
    }

    file.current = applied.snapshot;
    file.currentText = applied.snapshot.text;
    file.currentExists = applied.exists;
    file.hunks = buildHunks(file.baseline, file.current);
    file.revision += 1;
    if (file.hunks.length === 0 && file.baselineExists === file.currentExists) {
      this.files.delete(file.fileId);
      this.fileIdByUri.delete(uriKey(file.uri));
    }
    this.publish();
    return this.success();
  }

  private rejectHunkSnapshot(file: FileReview, hunkId: string): { snapshot: TextSnapshot; exists: boolean } | undefined {
    const hunk = file.hunks.find((item) => item.id === hunkId);
    if (!hunk) {
      return undefined;
    }
    const snapshot = applyRejectHunkToCurrent(file.baseline, file.current, hunk);
    const exists = !(file.baselineExists === false && snapshot.text.length === 0);
    return { snapshot, exists };
  }

  private async applySnapshot(
    file: FileReview,
    target: TextSnapshot,
    targetExists: boolean
  ): Promise<{ ok: true; snapshot: TextSnapshot; exists: boolean } | { ok: false; result: InlineDiffResult }> {
    const edit = new vscode.WorkspaceEdit();
    if (file.currentExists && !targetExists) {
      edit.deleteFile(file.uri, { ignoreIfNotExists: false, recursive: false });
    } else if (!file.currentExists && targetExists) {
      edit.createFile(file.uri, { ignoreIfExists: false, overwrite: false });
      edit.insert(file.uri, new vscode.Position(0, 0), target.text);
    } else if (file.currentExists && targetExists) {
      const document = await vscode.workspace.openTextDocument(file.uri);
      const end = document.positionAt(document.getText().length);
      edit.replace(file.uri, new vscode.Range(new vscode.Position(0, 0), end), target.text);
    }

    const key = uriKey(file.uri);
    this.internalChanges.add(key);
    try {
      const accepted = await vscode.workspace.applyEdit(edit);
      if (!accepted) {
        return { ok: false, result: this.failure('READ_ONLY', 'VS Code refused to apply the Reject edit.') };
      }
      if (targetExists) {
        const document = await vscode.workspace.openTextDocument(file.uri);
        const saved = await document.save();
        if (!saved) {
          return { ok: false, result: this.failure('SAVE_FAILED', 'The rejected content could not be saved to disk.') };
        }
      }
    } catch (error) {
      return { ok: false, result: this.failure('READ_ONLY', `Unable to write the rejected content: ${errorMessage(error)}`) };
    } finally {
      this.internalChanges.delete(key);
    }

    const verified = await this.readSnapshot(file.uri);
    if (!verified.ok || verified.exists !== targetExists || verified.snapshot.hash !== target.hash) {
      const reason = verified.ok
        ? 'The file changed while saving the rejected content (possibly by a formatter).'
        : verified.reason;
      return { ok: false, result: this.markStale(file, reason) };
    }
    return { ok: true, snapshot: verified.snapshot, exists: verified.exists };
  }

  private async readSnapshot(uri: vscode.Uri): Promise<SnapshotRead> {
    const open = vscode.workspace.textDocuments.find((document) => uriKey(document.uri) === uriKey(uri));
    if (open) {
      const text = open.getText();
      if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
        return { ok: false, reason: 'The file is larger than the 2 MiB inline diff limit.' };
      }
      return { ok: true, exists: true, snapshot: createTextSnapshot(text), dirty: open.isDirty };
    }

    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > MAX_FILE_BYTES) {
        return { ok: false, reason: 'The file is larger than the 2 MiB inline diff limit.' };
      }
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        return { ok: false, reason: 'The file is binary or is not valid UTF-8 text.' };
      }
      return { ok: true, exists: true, snapshot: createTextSnapshot(text), dirty: false };
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return { ok: true, exists: false, snapshot: createTextSnapshot(''), dirty: false };
      }
      return { ok: false, reason: `Unable to read the changed file: ${errorMessage(error)}` };
    }
  }

  private handleExternalDocumentChange(uri: vscode.Uri): void {
    if (this.activeRuns.size > 0) {
      return;
    }
    const file = this.getFileForUri(uri);
    if (!file || file.status !== 'pending') {
      return;
    }
    file.status = 'stale';
    file.reason = 'The document was edited manually after the inline diff was created.';
    file.revision += 1;
    this.publish();
  }

  private getFileForUri(uri: vscode.Uri): FileReview | undefined {
    const fileId = this.fileIdByUri.get(uriKey(uri));
    return fileId ? this.files.get(fileId) : undefined;
  }

  private markStale(file: FileReview, reason: string): InlineDiffResult {
    file.status = 'stale';
    file.reason = reason;
    file.revision += 1;
    this.publish();
    return this.failure('STALE_DOCUMENT', reason);
  }

  private publish(): void {
    this.snapshotRevision += 1;
    const snapshot = this.getSnapshot();
    this.editor.refresh();
    this.changeEmitter.fire(snapshot);
  }

  private success(): InlineDiffResult {
    return { ok: true, snapshot: this.getSnapshot() };
  }

  private failure(code: InlineDiffErrorCode, message: string): InlineDiffResult {
    return { ok: false, code, message, snapshot: this.getSnapshot() };
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.options.log?.(level, message);
  }
}

export function createInlineDiffController(options: InlineDiffControllerOptions): InlineDiffController {
  return new InlineDiffControllerImpl(options);
}

function unavailableCandidate(uri: vscode.Uri, displayPath: string, reason: string): ReviewCandidate {
  const empty = createTextSnapshot('');
  return {
    uri,
    displayPath,
    baseline: empty,
    current: empty,
    baselineExists: false,
    currentExists: false,
    status: 'unavailable',
    reason,
    canonical: false
  };
}

function isEditTool(part: TranscriptPartTool): boolean {
  return isEditToolName(part.toolName);
}

function extractEvidence(
  part: TranscriptPartTool,
  cwd: string
): Array<{
  uri: vscode.Uri;
  displayPath: string;
  operation: 'modify' | 'create' | 'delete' | 'rename' | 'unknown';
  status: ToolEvidenceStatus;
  oldText?: string;
  newText?: string;
  replacements: ToolTextReplacement[];
  unifiedDiff?: string;
}> {
  return extractToolEditEvidence(part).map((evidence) => {
    const uri = resolveFileUri(evidence.path, cwd);
    return {
      uri,
      displayPath: displayPathForUri(uri),
      operation: evidence.operation,
      status: evidence.status,
      oldText: evidence.oldText,
      newText: evidence.newText,
      replacements: evidence.replacements,
      unifiedDiff: evidence.unifiedDiff
    };
  });
}

function pickString(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof record?.[key] === 'string') {
      return record[key] as string;
    }
  }
  return undefined;
}

function resolveFileUri(filePath: string, cwd: string): vscode.Uri {
  if (filePath.startsWith('file://')) {
    return vscode.Uri.parse(filePath);
  }
  return vscode.Uri.file(path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(cwd, filePath));
}

function displayPathForUri(uri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  return folder ? path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/gu, '/') : uri.fsPath.replace(/\\/gu, '/');
}

function uriKey(uri: vscode.Uri): string {
  const value = uri.toString(true);
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function reverseSingleReplacement(current: string, oldText: string, newText: string): string | undefined {
  if (!newText) {
    return undefined;
  }
  const first = current.indexOf(newText);
  if (first < 0 || current.indexOf(newText, first + newText.length) >= 0) {
    return undefined;
  }
  return current.slice(0, first) + oldText + current.slice(first + newText.length);
}

function reverseReplacements(current: string, replacements: ToolTextReplacement[]): string | undefined {
  let reconstructed = current;
  for (const replacement of [...replacements].reverse()) {
    const next = reverseSingleReplacement(reconstructed, replacement.oldText, replacement.newText);
    if (next === undefined) {
      return undefined;
    }
    reconstructed = next;
  }
  return reconstructed;
}

function findRunUserMessageId(value: unknown, startedAt: number, promptText: string): string | undefined {
  const entries = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.messages) ? value.messages : [];
  const users = entries.flatMap((entry): Array<{ id: string; created: number; text: string }> => {
    if (!isRecord(entry)) {
      return [];
    }
    const info = isRecord(entry.info) ? entry.info : entry;
    if (info.role !== 'user' || typeof info.id !== 'string') {
      return [];
    }
    const time = isRecord(info.time) ? info.time : undefined;
    const created = typeof time?.created === 'number'
      ? time.created
      : typeof info.created === 'number'
        ? info.created
        : 0;
    const parts = Array.isArray(entry.parts) ? entry.parts : [];
    const text = parts
      .flatMap((part): string[] => isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : [])
      .join('');
    return [{ id: info.id, created, text }];
  });
  const eligible = users.filter((item) => item.created === 0 || item.created >= startedAt - 2_000);
  const timed = eligible.length > 0 ? eligible : users;
  const normalizedPrompt = promptText.trim();
  const exact = normalizedPrompt ? timed.filter((item) => item.text.trim() === normalizedPrompt) : [];
  return (exact.length > 0 ? exact : timed).sort((left, right) => right.created - left.created)[0]?.id;
}

function normalizeCanonicalDiff(value: unknown): CanonicalDiff[] {
  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.files)
      ? value.files
      : isRecord(value) && Array.isArray(value.diff)
        ? value.diff
        : isRecord(value) && Array.isArray(value.changes)
          ? value.changes
          : [];
  return list.flatMap((item): CanonicalDiff[] => {
    if (!isRecord(item)) {
      return [];
    }
    const filePath = pickString(item, ['file', 'path', 'filePath', 'filepath']);
    if (!filePath) {
      return [];
    }
    if (typeof item.patch === 'string' && item.patch.trim().length > 0) {
      return [{ path: filePath, patchText: item.patch }];
    }
    const beforeValue = pickNullableString(item, ['before', 'old', 'original', 'beforeText']);
    const afterValue = pickNullableString(item, ['after', 'new', 'current', 'afterText']);
    if (beforeValue === undefined && afterValue === undefined) {
      return [];
    }
    const status = typeof item.status === 'string' ? item.status.toLowerCase() : '';
    const beforeExists = status !== 'added' && status !== 'created' && beforeValue !== null;
    const afterExists = status !== 'deleted' && status !== 'removed' && afterValue !== null;
    return [{
      path: filePath,
      beforeText: typeof beforeValue === 'string' ? beforeValue : '',
      afterText: typeof afterValue === 'string' ? afterValue : '',
      beforeExists,
      afterExists
    }];
  });
}

function pickNullableString(record: Record<string, unknown>, keys: string[]): string | null | undefined {
  for (const key of keys) {
    if (record[key] === null || typeof record[key] === 'string') {
      return record[key] as string | null;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
