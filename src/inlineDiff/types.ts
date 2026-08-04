import type * as vscode from 'vscode';
import type { RunStreamEvent } from '../shared/protocol';

export type InlineDiffRunInput = {
  runId: string;
  sessionId: string;
  cwd: string;
  startedAt: number;
  promptText: string;
};

export type InlineDiffRunOutcome = 'done' | 'stopped' | 'failed';

export type InlineDiffFileStatus = 'pending' | 'stale' | 'unavailable';

export type InlineDiffFileSummary = {
  fileId: string;
  uri: string;
  path: string;
  displayPath: string;
  revision: number;
  status: InlineDiffFileStatus;
  reason?: string;
  hunkCount: number;
  additions: number;
  deletions: number;
};

export type InlineDiffSnapshot = {
  revision: number;
  activeRun: boolean;
  files: InlineDiffFileSummary[];
};

export type InlineDiffErrorCode =
  | 'FILE_NOT_FOUND'
  | 'REVIEW_UNAVAILABLE'
  | 'RUN_ACTIVE'
  | 'STALE_DOCUMENT'
  | 'READ_ONLY'
  | 'SAVE_FAILED'
  | 'INTERNAL_ERROR';

export type InlineDiffResult =
  | {
      ok: true;
      snapshot: InlineDiffSnapshot;
    }
  | {
      ok: false;
      code: InlineDiffErrorCode;
      message: string;
      snapshot: InlineDiffSnapshot;
    };

export type InlineDiffResolveInput = {
  fileId: string;
  hunkId?: string;
  revision: number;
  decision: 'accept' | 'reject';
};

export type InlineDiffRun = {
  observe(event: RunStreamEvent): void;
  finish(outcome: InlineDiffRunOutcome): Promise<void>;
};

export type InlineDiffController = vscode.Disposable & {
  beginRun(input: InlineDiffRunInput): InlineDiffRun;
  open(fileId: string): Promise<InlineDiffResult>;
  resolve(input: InlineDiffResolveInput): Promise<InlineDiffResult>;
  dismiss(fileId: string): void;
  invalidateAll(reason: string): void;
  getSnapshot(): InlineDiffSnapshot;
  readonly onDidChange: vscode.Event<InlineDiffSnapshot>;
};

export type InlineDiffControllerOptions = {
  requestServeJson<T>(pathname: string): Promise<T>;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
  virtualDocumentScheme?: string;
  commandPrefix?: string;
};
