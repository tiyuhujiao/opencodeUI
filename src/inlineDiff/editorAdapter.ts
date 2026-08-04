import * as vscode from 'vscode';
import type { ReviewHunk } from './core';
import type { InlineDiffResolveInput, InlineDiffResult } from './types';

export type EditorReviewFile = {
  fileId: string;
  uri: vscode.Uri;
  displayPath: string;
  revision: number;
  status: 'pending' | 'stale' | 'unavailable';
  reason?: string;
  baselineText: string;
  currentText: string;
  baselineExists: boolean;
  currentExists: boolean;
  hunks: ReviewHunk[];
};

export type InlineDiffEditorAdapterOptions = {
  getFile(fileId: string): EditorReviewFile | undefined;
  getFileForUri(uri: vscode.Uri): EditorReviewFile | undefined;
  listFiles(): EditorReviewFile[];
  isReviewPaused(): boolean;
  resolve(input: InlineDiffResolveInput): Promise<InlineDiffResult>;
  dismiss(fileId: string): void;
  onExternalDocumentChange(uri: vscode.Uri): void;
  isInternalDocumentChange(uri: vscode.Uri): boolean;
  virtualDocumentScheme?: string;
  commandPrefix?: string;
};

const DEFAULT_VIRTUAL_SCHEME = 'opencode-inline-diff';
const DEFAULT_COMMAND_PREFIX = 'opencodeUI.inlineDiff';

export class InlineDiffEditorAdapter implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly virtualDocuments = new Map<string, string>();
  private readonly virtualEmitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly codeLensEmitter = new vscode.EventEmitter<void>();
  private readonly virtualDocumentScheme: string;
  private readonly commandPrefix: string;
  private readonly addedDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
    overviewRulerColor: new vscode.ThemeColor('diffEditorOverview.insertedForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left
  });
  private readonly deletedDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
    overviewRulerColor: new vscode.ThemeColor('diffEditorOverview.removedForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left
  });

  constructor(private readonly options: InlineDiffEditorAdapterOptions) {
    this.virtualDocumentScheme = options.virtualDocumentScheme ?? DEFAULT_VIRTUAL_SCHEME;
    this.commandPrefix = options.commandPrefix ?? DEFAULT_COMMAND_PREFIX;
    const contentProvider: vscode.TextDocumentContentProvider = {
      onDidChange: this.virtualEmitter.event,
      provideTextDocumentContent: (uri) => this.virtualDocuments.get(uri.toString()) ?? ''
    };
    const codeLensProvider: vscode.CodeLensProvider = {
      onDidChangeCodeLenses: this.codeLensEmitter.event,
      provideCodeLenses: (document) => this.provideCodeLenses(document)
    };

    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(this.virtualDocumentScheme, contentProvider),
      vscode.languages.registerCodeLensProvider(
        [{ scheme: 'file' }, { scheme: 'vscode-remote' }, { scheme: this.virtualDocumentScheme }],
        codeLensProvider
      ),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!this.options.isInternalDocumentChange(event.document.uri)) {
          this.options.onExternalDocumentChange(event.document.uri);
        }
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshDecorations()),
      vscode.commands.registerCommand(`${this.commandPrefix}.open`, (fileId: string) => this.open(fileId)),
      vscode.commands.registerCommand(`${this.commandPrefix}.acceptHunk`, (input: InlineDiffResolveInput) =>
        this.runResolve({ ...input, decision: 'accept' })
      ),
      vscode.commands.registerCommand(`${this.commandPrefix}.rejectHunk`, (input: InlineDiffResolveInput) =>
        this.runResolve({ ...input, decision: 'reject' })
      ),
      vscode.commands.registerCommand(`${this.commandPrefix}.acceptFile`, (input: InlineDiffResolveInput) =>
        this.runResolve({ ...input, hunkId: undefined, decision: 'accept' })
      ),
      vscode.commands.registerCommand(`${this.commandPrefix}.rejectFile`, (input: InlineDiffResolveInput) =>
        this.runResolve({ ...input, hunkId: undefined, decision: 'reject' })
      ),
      vscode.commands.registerCommand(`${this.commandPrefix}.viewDiff`, (fileId: string) => this.openNativeDiff(fileId)),
      vscode.commands.registerCommand(`${this.commandPrefix}.dismiss`, (fileId: string) => this.options.dismiss(fileId)),
      this.virtualEmitter,
      this.codeLensEmitter,
      this.addedDecoration,
      this.deletedDecoration
    );
  }

  refresh(): void {
    for (const file of this.options.listFiles()) {
      this.setVirtualDocument(this.beforeUri(file), file.baselineText);
      this.setVirtualDocument(this.afterUri(file), file.currentText);
    }
    this.codeLensEmitter.fire();
    this.refreshDecorations();
  }

  async open(fileId: string): Promise<boolean> {
    return this.openNativeDiff(fileId);
  }

  async openNativeDiff(fileId: string): Promise<boolean> {
    const file = this.options.getFile(fileId);
    if (!file) {
      return false;
    }
    const before = this.beforeUri(file);
    const after = file.currentExists ? file.uri : this.afterUri(file);
    this.setVirtualDocument(before, file.baselineText);
    this.setVirtualDocument(this.afterUri(file), file.currentText);
    await vscode.commands.executeCommand(
      'vscode.diff',
      before,
      after,
      `${file.displayPath} (OpenCode Changes)`,
      { preview: true }
    );
    return true;
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.virtualDocuments.clear();
  }

  private provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const file = this.getFileForDocument(document.uri);
    if (this.options.isReviewPaused() || !file || file.status !== 'pending' || file.hunks.length === 0) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    file.hunks.forEach((hunk, index) => {
      const line = Math.min(hunk.afterStartLine, Math.max(0, document.lineCount - 1));
      const range = new vscode.Range(line, 0, line, 0);
      const input = { fileId: file.fileId, hunkId: hunk.id, revision: file.revision };
      lenses.push(
        new vscode.CodeLens(range, {
          command: `${this.commandPrefix}.acceptHunk`,
          title: '$(check) Accept',
          arguments: [input]
        }),
        new vscode.CodeLens(range, {
          command: `${this.commandPrefix}.rejectHunk`,
          title: '$(discard) Reject',
          arguments: [input]
        }),
        new vscode.CodeLens(range, {
          command: `${this.commandPrefix}.viewDiff`,
          title: '$(diff) View Full Diff',
          arguments: [file.fileId]
        })
      );
      if (index === 0) {
        const fileInput = { fileId: file.fileId, revision: file.revision };
        lenses.push(
          new vscode.CodeLens(range, {
            command: `${this.commandPrefix}.acceptFile`,
            title: '$(check-all) Accept File',
            arguments: [fileInput]
          }),
          new vscode.CodeLens(range, {
            command: `${this.commandPrefix}.rejectFile`,
            title: '$(trash) Reject File',
            arguments: [fileInput]
          })
        );
      }
    });
    return lenses;
  }

  private refreshDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.decorateEditor(editor);
    }
  }

  private decorateEditor(editor: vscode.TextEditor): void {
    const file = this.getFileForDocument(editor.document.uri);
    if (!file || file.status !== 'pending') {
      editor.setDecorations(this.addedDecoration, []);
      editor.setDecorations(this.deletedDecoration, []);
      return;
    }

    if (!file.currentExists) {
      const endLine = Math.max(0, editor.document.lineCount - 1);
      editor.setDecorations(this.addedDecoration, []);
      editor.setDecorations(this.deletedDecoration, [
        {
          range: new vscode.Range(0, 0, endLine, editor.document.lineAt(endLine).text.length),
          hoverMessage: new vscode.MarkdownString('**OpenCode deleted this file.**')
        }
      ]);
      return;
    }

    const added: vscode.DecorationOptions[] = [];
    const deleted: vscode.DecorationOptions[] = [];
    for (const hunk of file.hunks) {
      if (hunk.additions > 0) {
        added.push({ range: this.toEditorRange(editor.document, hunk.afterStartLine, hunk.afterEndLine) });
      }
      if (hunk.deletions > 0) {
        const line = Math.min(hunk.afterStartLine, Math.max(0, editor.document.lineCount - 1));
        const hover = new vscode.MarkdownString();
        hover.appendMarkdown(`**${hunk.deletions} deleted line${hunk.deletions === 1 ? '' : 's'}**\n\n`);
        hover.appendCodeblock(hunk.beforeText || '(empty)', editor.document.languageId);
        deleted.push({
          range: new vscode.Range(line, 0, line, Math.max(0, editor.document.lineAt(line).text.length)),
          hoverMessage: hover,
          renderOptions: {
            after: {
              contentText: `  -${hunk.deletions} line${hunk.deletions === 1 ? '' : 's'}`,
              color: new vscode.ThemeColor('errorForeground'),
              fontStyle: 'italic'
            }
          }
        });
      }
    }
    editor.setDecorations(this.addedDecoration, added);
    editor.setDecorations(this.deletedDecoration, deleted);
  }

  private toEditorRange(document: vscode.TextDocument, startLine: number, endLine: number): vscode.Range {
    if (document.lineCount === 0) {
      return new vscode.Range(0, 0, 0, 0);
    }
    const start = Math.min(startLine, document.lineCount - 1);
    const end = Math.min(Math.max(start + 1, endLine), document.lineCount);
    return new vscode.Range(start, 0, end - 1, document.lineAt(end - 1).text.length);
  }

  private beforeUri(file: EditorReviewFile): vscode.Uri {
    return this.virtualUri('before', file);
  }

  private afterUri(file: EditorReviewFile): vscode.Uri {
    return this.virtualUri('after', file);
  }

  private virtualUri(kind: 'before' | 'after', file: EditorReviewFile): vscode.Uri {
    return vscode.Uri.from({
      scheme: this.virtualDocumentScheme,
      authority: kind,
      path: `/${encodeURIComponent(file.fileId)}/${encodeURIComponent(file.displayPath)}`,
      query: `revision=${file.revision}`
    });
  }

  private setVirtualDocument(uri: vscode.Uri, text: string): void {
    const key = uri.toString();
    if (this.virtualDocuments.get(key) === text) {
      return;
    }
    this.virtualDocuments.set(key, text);
    this.virtualEmitter.fire(uri);
  }

  private async runResolve(input: InlineDiffResolveInput): Promise<void> {
    const result = await this.options.resolve(input);
    if (!result.ok) {
      void vscode.window.showWarningMessage(result.message);
    }
  }

  private getFileForDocument(uri: vscode.Uri): EditorReviewFile | undefined {
    const direct = this.options.getFileForUri(uri);
    if (direct || uri.scheme !== this.virtualDocumentScheme) {
      return direct;
    }
    const encodedId = uri.path.split('/').filter(Boolean)[0];
    if (!encodedId) {
      return undefined;
    }
    try {
      return this.options.getFile(decodeURIComponent(encodedId));
    } catch {
      return undefined;
    }
  }
}
