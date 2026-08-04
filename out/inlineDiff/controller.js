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
exports.createInlineDiffController = createInlineDiffController;
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const core_1 = require("./core");
const editorAdapter_1 = require("./editorAdapter");
const toolEvidence_1 = require("./toolEvidence");
const unifiedPatch_1 = require("./unifiedPatch");
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_RUN_BYTES = 20 * 1024 * 1024;
const SESSION_DIFF_DELAYS_MS = [0, 100, 300, 700];
class InlineDiffControllerImpl {
    constructor(options) {
        this.options = options;
        this.files = new Map();
        this.fileIdByUri = new Map();
        this.changeEmitter = new vscode.EventEmitter();
        this.activeRuns = new Set();
        this.internalChanges = new Set();
        this.snapshotRevision = 0;
        this.disposed = false;
        this.onDidChange = this.changeEmitter.event;
        this.editor = new editorAdapter_1.InlineDiffEditorAdapter({
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
    beginRun(input) {
        const state = { input, evidence: new Map(), finished: false };
        this.activeRuns.add(input.runId);
        this.publish();
        return {
            observe: (event) => {
                try {
                    this.observeRunEvent(state, event);
                }
                catch (error) {
                    this.log('warn', `inline diff observe failed: ${errorMessage(error)}`);
                }
            },
            finish: async (outcome) => {
                if (state.finished) {
                    return;
                }
                state.finished = true;
                try {
                    await this.finishRun(state, outcome);
                }
                catch (error) {
                    this.log('error', `inline diff finish failed: ${errorMessage(error)}`);
                }
                finally {
                    this.activeRuns.delete(input.runId);
                    this.publish();
                }
            }
        };
    }
    async open(fileId) {
        try {
            const opened = await this.editor.openNativeDiff(fileId);
            return opened ? this.success() : this.failure('FILE_NOT_FOUND', 'This inline diff review no longer exists.');
        }
        catch (error) {
            return this.failure('INTERNAL_ERROR', `Unable to open inline diff: ${errorMessage(error)}`);
        }
    }
    async resolve(input) {
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
        }
        catch (error) {
            if (error instanceof core_1.InlineDiffConflictError) {
                return this.markStale(file, error.message);
            }
            return this.failure('INTERNAL_ERROR', `Unable to update inline diff: ${errorMessage(error)}`);
        }
    }
    dismiss(fileId) {
        const file = this.files.get(fileId);
        if (!file) {
            return;
        }
        this.files.delete(fileId);
        this.fileIdByUri.delete(uriKey(file.uri));
        this.publish();
    }
    invalidateAll(reason) {
        for (const file of this.files.values()) {
            file.status = 'stale';
            file.reason = reason;
            file.revision += 1;
        }
        this.publish();
    }
    getSnapshot() {
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
    dispose() {
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
    observeRunEvent(state, event) {
        if (state.finished || event.type !== 'part' || event.part.type !== 'tool' || !isEditTool(event.part)) {
            return;
        }
        for (const evidence of extractEvidence(event.part, state.input.cwd)) {
            const key = uriKey(evidence.uri);
            const existing = state.evidence.get(key);
            if (existing) {
                existing.oldText ?? (existing.oldText = evidence.oldText);
                existing.newText ?? (existing.newText = evidence.newText);
                if (existing.operation === 'unknown') {
                    existing.operation = evidence.operation;
                }
                continue;
            }
            state.evidence.set(key, {
                ...evidence,
                before: this.readSnapshot(evidence.uri)
            });
        }
    }
    async finishRun(state, outcome) {
        const canonical = await this.loadCanonicalDiff(state.input);
        const candidates = canonical.length > 0
            ? await this.candidatesFromCanonical(canonical, state.input.cwd)
            : await this.candidatesFromEvidence(state.evidence);
        let totalBytes = 0;
        for (const candidate of candidates) {
            totalBytes += Buffer.byteLength(candidate.baseline.text, 'utf8') + Buffer.byteLength(candidate.current.text, 'utf8');
            if (totalBytes > MAX_RUN_BYTES) {
                this.upsertUnavailable(candidate, 'The inline diff snapshot budget for this run exceeded 20 MiB.');
                continue;
            }
            this.upsertCandidate(candidate);
        }
        const firstPending = candidates
            .map((candidate) => this.getFileForUri(candidate.uri))
            .find((file) => file?.status === 'pending');
        if (firstPending) {
            await this.editor.openNativeDiff(firstPending.fileId);
        }
        this.log('info', `inline diff run ${state.input.runId} (${outcome}) produced ${candidates.length} review candidate(s)`);
    }
    async loadCanonicalDiff(input) {
        let messageId;
        try {
            const messages = await this.options.requestServeJson(`/session/${encodeURIComponent(input.sessionId)}/message`);
            messageId = findRunUserMessageId(messages, input.startedAt, input.promptText);
        }
        catch (error) {
            this.log('warn', `inline diff message lookup failed: ${errorMessage(error)}`);
        }
        const pathname = `/session/${encodeURIComponent(input.sessionId)}/diff${messageId ? `?messageID=${encodeURIComponent(messageId)}` : ''}`;
        for (const delayMs of SESSION_DIFF_DELAYS_MS) {
            if (delayMs > 0) {
                await delay(delayMs);
            }
            try {
                const response = await this.options.requestServeJson(pathname);
                const parsed = normalizeCanonicalDiff(response);
                if (parsed.length > 0) {
                    return parsed;
                }
            }
            catch (error) {
                this.log('warn', `inline diff endpoint attempt failed: ${errorMessage(error)}`);
            }
        }
        return [];
    }
    async candidatesFromCanonical(items, cwd) {
        const candidates = [];
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
                    const reversed = (0, unifiedPatch_1.reverseUnifiedPatch)(actual.snapshot.text, item.patchText, { currentExists: actual.exists });
                    candidates.push({
                        uri,
                        displayPath,
                        baseline: (0, core_1.createTextSnapshot)(reversed.beforeText),
                        current: actual.snapshot,
                        baselineExists: reversed.beforeExists,
                        currentExists: reversed.afterExists,
                        status: actual.dirty ? 'stale' : 'pending',
                        reason: actual.dirty ? 'The document has unsaved changes, so Reject is disabled.' : undefined,
                        canonical: true
                    });
                }
                catch (error) {
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
            const baseline = (0, core_1.createTextSnapshot)(beforeText);
            const endpointAfter = (0, core_1.createTextSnapshot)(afterText);
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
    async candidatesFromEvidence(evidenceByUri) {
        const candidates = [];
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
                if (evidence.operation === 'create' && evidence.newText === current.snapshot.text) {
                    baseline = (0, core_1.createTextSnapshot)('');
                    baselineExists = false;
                }
                else if (evidence.operation === 'delete' && !current.exists && evidence.oldText !== undefined) {
                    baseline = (0, core_1.createTextSnapshot)(evidence.oldText);
                    baselineExists = true;
                }
                else if (evidence.oldText !== undefined && evidence.newText !== undefined) {
                    const reconstructed = reverseSingleReplacement(current.snapshot.text, evidence.oldText, evidence.newText);
                    if (reconstructed !== undefined) {
                        baseline = (0, core_1.createTextSnapshot)(reconstructed);
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
    upsertCandidate(candidate) {
        const key = uriKey(candidate.uri);
        const existingId = this.fileIdByUri.get(key);
        const existing = existingId ? this.files.get(existingId) : undefined;
        let baseline = candidate.baseline;
        let baselineExists = candidate.baselineExists;
        let status = candidate.status;
        let reason = candidate.reason;
        if (existing?.status === 'pending') {
            if (existing.current.hash === candidate.baseline.hash && existing.currentExists === candidate.baselineExists) {
                baseline = existing.baseline;
                baselineExists = existing.baselineExists;
            }
            else {
                status = 'stale';
                reason = 'A later OpenCode run started from content that no longer matches this pending review.';
            }
        }
        const hunks = (0, core_1.buildHunks)(baseline, candidate.current);
        if (candidate.status !== 'unavailable' && hunks.length === 0 && baselineExists === candidate.currentExists) {
            if (existing) {
                this.files.delete(existing.fileId);
                this.fileIdByUri.delete(key);
            }
            return;
        }
        const fileId = existing?.fileId ?? `file-${(0, core_1.hashText)(key)}`;
        const review = {
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
            hunks
        };
        this.files.set(fileId, review);
        this.fileIdByUri.set(key, fileId);
    }
    upsertUnavailable(candidate, reason) {
        const unavailable = { ...candidate, status: 'unavailable', reason };
        this.upsertCandidate(unavailable);
    }
    accept(file, hunkId) {
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
        file.baseline = (0, core_1.applyAcceptHunkToBaseline)(file.baseline, file.current, hunk);
        file.baselineText = file.baseline.text;
        file.hunks = (0, core_1.buildHunks)(file.baseline, file.current);
        file.revision += 1;
        if (file.hunks.length === 0) {
            file.baselineExists = file.currentExists;
            this.files.delete(file.fileId);
            this.fileIdByUri.delete(uriKey(file.uri));
        }
        this.publish();
        return this.success();
    }
    async reject(file, hunkId) {
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
        file.hunks = (0, core_1.buildHunks)(file.baseline, file.current);
        file.revision += 1;
        if (file.hunks.length === 0 && file.baselineExists === file.currentExists) {
            this.files.delete(file.fileId);
            this.fileIdByUri.delete(uriKey(file.uri));
        }
        this.publish();
        return this.success();
    }
    rejectHunkSnapshot(file, hunkId) {
        const hunk = file.hunks.find((item) => item.id === hunkId);
        if (!hunk) {
            return undefined;
        }
        const snapshot = (0, core_1.applyRejectHunkToCurrent)(file.baseline, file.current, hunk);
        const exists = !(file.baselineExists === false && snapshot.text.length === 0);
        return { snapshot, exists };
    }
    async applySnapshot(file, target, targetExists) {
        const edit = new vscode.WorkspaceEdit();
        if (file.currentExists && !targetExists) {
            edit.deleteFile(file.uri, { ignoreIfNotExists: false, recursive: false });
        }
        else if (!file.currentExists && targetExists) {
            edit.createFile(file.uri, { ignoreIfExists: false, overwrite: false });
            edit.insert(file.uri, new vscode.Position(0, 0), target.text);
        }
        else if (file.currentExists && targetExists) {
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
        }
        catch (error) {
            return { ok: false, result: this.failure('READ_ONLY', `Unable to write the rejected content: ${errorMessage(error)}`) };
        }
        finally {
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
    async readSnapshot(uri) {
        const open = vscode.workspace.textDocuments.find((document) => uriKey(document.uri) === uriKey(uri));
        if (open) {
            const text = open.getText();
            if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
                return { ok: false, reason: 'The file is larger than the 2 MiB inline diff limit.' };
            }
            return { ok: true, exists: true, snapshot: (0, core_1.createTextSnapshot)(text), dirty: open.isDirty };
        }
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            if (bytes.byteLength > MAX_FILE_BYTES) {
                return { ok: false, reason: 'The file is larger than the 2 MiB inline diff limit.' };
            }
            let text;
            try {
                text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            }
            catch {
                return { ok: false, reason: 'The file is binary or is not valid UTF-8 text.' };
            }
            return { ok: true, exists: true, snapshot: (0, core_1.createTextSnapshot)(text), dirty: false };
        }
        catch (error) {
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                return { ok: true, exists: false, snapshot: (0, core_1.createTextSnapshot)(''), dirty: false };
            }
            return { ok: false, reason: `Unable to read the changed file: ${errorMessage(error)}` };
        }
    }
    handleExternalDocumentChange(uri) {
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
    getFileForUri(uri) {
        const fileId = this.fileIdByUri.get(uriKey(uri));
        return fileId ? this.files.get(fileId) : undefined;
    }
    markStale(file, reason) {
        file.status = 'stale';
        file.reason = reason;
        file.revision += 1;
        this.publish();
        return this.failure('STALE_DOCUMENT', reason);
    }
    publish() {
        this.snapshotRevision += 1;
        const snapshot = this.getSnapshot();
        this.editor.refresh();
        this.changeEmitter.fire(snapshot);
    }
    success() {
        return { ok: true, snapshot: this.getSnapshot() };
    }
    failure(code, message) {
        return { ok: false, code, message, snapshot: this.getSnapshot() };
    }
    log(level, message) {
        this.options.log?.(level, message);
    }
}
function createInlineDiffController(options) {
    return new InlineDiffControllerImpl(options);
}
function unavailableCandidate(uri, displayPath, reason) {
    const empty = (0, core_1.createTextSnapshot)('');
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
function isEditTool(part) {
    return (0, toolEvidence_1.isEditToolName)(part.toolName);
}
function extractEvidence(part, cwd) {
    return (0, toolEvidence_1.extractToolEditEvidence)(part).map((evidence) => {
        const uri = resolveFileUri(evidence.path, cwd);
        return {
            uri,
            displayPath: displayPathForUri(uri),
            operation: evidence.operation,
            oldText: evidence.oldText,
            newText: evidence.newText
        };
    });
}
function pickString(record, keys) {
    for (const key of keys) {
        if (typeof record?.[key] === 'string') {
            return record[key];
        }
    }
    return undefined;
}
function resolveFileUri(filePath, cwd) {
    if (filePath.startsWith('file://')) {
        return vscode.Uri.parse(filePath);
    }
    return vscode.Uri.file(path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(cwd, filePath));
}
function displayPathForUri(uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder ? path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/gu, '/') : uri.fsPath.replace(/\\/gu, '/');
}
function uriKey(uri) {
    const value = uri.toString(true);
    return process.platform === 'win32' ? value.toLowerCase() : value;
}
function reverseSingleReplacement(current, oldText, newText) {
    if (!newText) {
        return undefined;
    }
    const first = current.indexOf(newText);
    if (first < 0 || current.indexOf(newText, first + newText.length) >= 0) {
        return undefined;
    }
    return current.slice(0, first) + oldText + current.slice(first + newText.length);
}
function findRunUserMessageId(value, startedAt, promptText) {
    const entries = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.messages) ? value.messages : [];
    const users = entries.flatMap((entry) => {
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
            .flatMap((part) => isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : [])
            .join('');
        return [{ id: info.id, created, text }];
    });
    const eligible = users.filter((item) => item.created === 0 || item.created >= startedAt - 2000);
    const timed = eligible.length > 0 ? eligible : users;
    const normalizedPrompt = promptText.trim();
    const exact = normalizedPrompt ? timed.filter((item) => item.text.trim() === normalizedPrompt) : [];
    return (exact.length > 0 ? exact : timed).sort((left, right) => right.created - left.created)[0]?.id;
}
function normalizeCanonicalDiff(value) {
    const list = Array.isArray(value)
        ? value
        : isRecord(value) && Array.isArray(value.files)
            ? value.files
            : isRecord(value) && Array.isArray(value.diff)
                ? value.diff
                : isRecord(value) && Array.isArray(value.changes)
                    ? value.changes
                    : [];
    return list.flatMap((item) => {
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
function pickNullableString(record, keys) {
    for (const key of keys) {
        if (record[key] === null || typeof record[key] === 'string') {
            return record[key];
        }
    }
    return undefined;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=controller.js.map