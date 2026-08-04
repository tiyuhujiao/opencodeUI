"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.InlineDiffEditorAdapter = void 0;
const vscode = __importStar(require("vscode"));
const DEFAULT_VIRTUAL_SCHEME = 'opencode-inline-diff';
const DEFAULT_COMMAND_PREFIX = 'opencodeUI.inlineDiff';
class InlineDiffEditorAdapter {
    constructor(options) {
        this.options = options;
        this.disposables = [];
        this.virtualDocuments = new Map();
        this.virtualEmitter = new vscode.EventEmitter();
        this.codeLensEmitter = new vscode.EventEmitter();
        this.addedDecoration = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
            overviewRulerColor: new vscode.ThemeColor('diffEditorOverview.insertedForeground'),
            overviewRulerLane: vscode.OverviewRulerLane.Left
        });
        this.deletedDecoration = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
            overviewRulerColor: new vscode.ThemeColor('diffEditorOverview.removedForeground'),
            overviewRulerLane: vscode.OverviewRulerLane.Left
        });
        this.virtualDocumentScheme = options.virtualDocumentScheme ?? DEFAULT_VIRTUAL_SCHEME;
        this.commandPrefix = options.commandPrefix ?? DEFAULT_COMMAND_PREFIX;
        const contentProvider = {
            onDidChange: this.virtualEmitter.event,
            provideTextDocumentContent: (uri) => this.virtualDocuments.get(uri.toString()) ?? ''
        };
        const codeLensProvider = {
            onDidChangeCodeLenses: this.codeLensEmitter.event,
            provideCodeLenses: (document) => this.provideCodeLenses(document)
        };
        this.disposables.push(vscode.workspace.registerTextDocumentContentProvider(this.virtualDocumentScheme, contentProvider), vscode.languages.registerCodeLensProvider([{ scheme: 'file' }, { scheme: 'vscode-remote' }, { scheme: this.virtualDocumentScheme }], codeLensProvider), vscode.workspace.onDidChangeTextDocument((event) => {
            if (!this.options.isInternalDocumentChange(event.document.uri)) {
                this.options.onExternalDocumentChange(event.document.uri);
            }
        }), vscode.window.onDidChangeVisibleTextEditors(() => this.refreshDecorations()), vscode.commands.registerCommand(`${this.commandPrefix}.open`, (fileId) => this.open(fileId)), vscode.commands.registerCommand(`${this.commandPrefix}.acceptHunk`, (input) => this.runResolve({ ...input, decision: 'accept' })), vscode.commands.registerCommand(`${this.commandPrefix}.rejectHunk`, (input) => this.runResolve({ ...input, decision: 'reject' })), vscode.commands.registerCommand(`${this.commandPrefix}.acceptFile`, (input) => this.runResolve({ ...input, hunkId: undefined, decision: 'accept' })), vscode.commands.registerCommand(`${this.commandPrefix}.rejectFile`, (input) => this.runResolve({ ...input, hunkId: undefined, decision: 'reject' })), vscode.commands.registerCommand(`${this.commandPrefix}.viewDiff`, (fileId) => this.openNativeDiff(fileId)), vscode.commands.registerCommand(`${this.commandPrefix}.dismiss`, (fileId) => this.options.dismiss(fileId)), this.virtualEmitter, this.codeLensEmitter, this.addedDecoration, this.deletedDecoration);
    }
    refresh() {
        for (const file of this.options.listFiles()) {
            this.setVirtualDocument(this.beforeUri(file), file.baselineText);
            this.setVirtualDocument(this.afterUri(file), file.currentText);
        }
        this.codeLensEmitter.fire();
        this.refreshDecorations();
    }
    async open(fileId) {
        return this.openNativeDiff(fileId);
    }
    async openNativeDiff(fileId) {
        const file = this.options.getFile(fileId);
        if (!file) {
            return false;
        }
        const before = this.beforeUri(file);
        const after = file.currentExists ? file.uri : this.afterUri(file);
        this.setVirtualDocument(before, file.baselineText);
        this.setVirtualDocument(this.afterUri(file), file.currentText);
        await vscode.commands.executeCommand('vscode.diff', before, after, `${file.displayPath} (OpenCode Changes)`, { preview: true });
        return true;
    }
    dispose() {
        for (const disposable of this.disposables.splice(0)) {
            disposable.dispose();
        }
        this.virtualDocuments.clear();
    }
    provideCodeLenses(document) {
        const file = this.getFileForDocument(document.uri);
        if (this.options.isReviewPaused() || !file || file.status !== 'pending' || file.hunks.length === 0) {
            return [];
        }
        const lenses = [];
        file.hunks.forEach((hunk, index) => {
            const line = Math.min(hunk.afterStartLine, Math.max(0, document.lineCount - 1));
            const range = new vscode.Range(line, 0, line, 0);
            const input = { fileId: file.fileId, hunkId: hunk.id, revision: file.revision };
            lenses.push(new vscode.CodeLens(range, {
                command: `${this.commandPrefix}.acceptHunk`,
                title: '$(check) Accept',
                arguments: [input]
            }), new vscode.CodeLens(range, {
                command: `${this.commandPrefix}.rejectHunk`,
                title: '$(discard) Reject',
                arguments: [input]
            }), new vscode.CodeLens(range, {
                command: `${this.commandPrefix}.viewDiff`,
                title: '$(diff) View Full Diff',
                arguments: [file.fileId]
            }));
            if (index === 0) {
                const fileInput = { fileId: file.fileId, revision: file.revision };
                lenses.push(new vscode.CodeLens(range, {
                    command: `${this.commandPrefix}.acceptFile`,
                    title: '$(check-all) Accept File',
                    arguments: [fileInput]
                }), new vscode.CodeLens(range, {
                    command: `${this.commandPrefix}.rejectFile`,
                    title: '$(trash) Reject File',
                    arguments: [fileInput]
                }));
            }
        });
        return lenses;
    }
    refreshDecorations() {
        for (const editor of vscode.window.visibleTextEditors) {
            this.decorateEditor(editor);
        }
    }
    decorateEditor(editor) {
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
        const added = [];
        const deleted = [];
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
    toEditorRange(document, startLine, endLine) {
        if (document.lineCount === 0) {
            return new vscode.Range(0, 0, 0, 0);
        }
        const start = Math.min(startLine, document.lineCount - 1);
        const end = Math.min(Math.max(start + 1, endLine), document.lineCount);
        return new vscode.Range(start, 0, end - 1, document.lineAt(end - 1).text.length);
    }
    beforeUri(file) {
        return this.virtualUri('before', file);
    }
    afterUri(file) {
        return this.virtualUri('after', file);
    }
    virtualUri(kind, file) {
        return vscode.Uri.from({
            scheme: this.virtualDocumentScheme,
            authority: kind,
            path: `/${encodeURIComponent(file.fileId)}/${encodeURIComponent(file.displayPath)}`,
            query: `revision=${file.revision}`
        });
    }
    setVirtualDocument(uri, text) {
        const key = uri.toString();
        if (this.virtualDocuments.get(key) === text) {
            return;
        }
        this.virtualDocuments.set(key, text);
        this.virtualEmitter.fire(uri);
    }
    async runResolve(input) {
        const result = await this.options.resolve(input);
        if (!result.ok) {
            void vscode.window.showWarningMessage(result.message);
        }
    }
    getFileForDocument(uri) {
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
        }
        catch {
            return undefined;
        }
    }
}
exports.InlineDiffEditorAdapter = InlineDiffEditorAdapter;
//# sourceMappingURL=editorAdapter.js.map