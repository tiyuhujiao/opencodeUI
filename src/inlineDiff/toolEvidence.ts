export type ToolPartLike = {
  toolName: string;
  status?: string;
  raw: unknown;
};

export type ToolEvidenceStatus = 'pending' | 'running' | 'completed' | 'error' | 'unknown';
export type ToolEditOperation = 'modify' | 'create' | 'delete' | 'rename' | 'unknown';
export type ToolEvidenceSource = 'input' | 'unified-diff' | 'patch-marker';

export type ToolTextReplacement = {
  oldText: string;
  newText: string;
};

export type ToolEditEvidence = {
  toolId: string | null;
  toolName: string;
  status: ToolEvidenceStatus;
  path: string;
  operation: ToolEditOperation;
  source: ToolEvidenceSource;
  oldPath?: string;
  newPath?: string;
  oldText?: string;
  newText?: string;
  replacements: ToolTextReplacement[];
  unifiedDiff?: string;
  patchText?: string;
};

type EvidenceDraft = Omit<ToolEditEvidence, 'toolId' | 'toolName' | 'status'>;

const EDIT_TOOL_NAMES = new Set([
  'edit',
  'multiedit',
  'multi_edit',
  'write',
  'patch',
  'apply_patch',
  'str_replace_editor',
  'create',
  'insert'
]);

const PATH_KEYS = [
  'filePath',
  'filepath',
  'file_path',
  'path',
  'relativePath',
  'relative_path',
  'target',
  'targetFile',
  'target_file'
];

const OLD_TEXT_KEYS = ['oldString', 'old_string', 'oldText', 'old_text', 'old'];
const NEW_TEXT_KEYS = ['newString', 'new_string', 'newText', 'new_text', 'content', 'text'];
const DIFF_KEYS = ['diff', 'patch', 'output', 'stdout', 'result'];

export function extractToolEditEvidence(part: ToolPartLike): ToolEditEvidence[] {
  const toolName = normalizeToolName(part.toolName);
  if (!isEditToolName(toolName)) {
    return [];
  }

  const root = asRecord(part.raw);
  const nestedPart = asRecord(root?.part);
  const state = asRecord(nestedPart?.state) ?? asRecord(root?.state);
  const input = asRecord(state?.input) ?? asRecord(nestedPart?.input) ?? asRecord(root?.input);
  const toolId = pickToolId(root, nestedPart, state);
  const status = normalizeStatus(
    pickString(state, ['status']) ??
      pickString(nestedPart, ['status']) ??
      pickString(root, ['status']) ??
      part.status
  );
  const drafts: EvidenceDraft[] = [];

  for (const text of collectCandidateTexts(part.raw)) {
    if (looksLikePatchMarker(text)) {
      drafts.push(...parsePatchMarker(text));
    } else if (looksLikeUnifiedDiff(text)) {
      drafts.push(...parseUnifiedDiff(text));
    }
  }

  const directPaths = collectPaths(input ?? state ?? nestedPart ?? root);
  const replacements = collectDirectReplacements(input ?? state ?? nestedPart ?? root);
  const directOldText = replacements[0]?.oldText;
  const directNewText = replacements[0]?.newText;
  for (const path of directPaths) {
    drafts.push({
      path,
      operation: inferDirectOperation(toolName, directOldText, directNewText),
      source: 'input',
      oldText: directOldText,
      newText: directNewText,
      replacements,
      ...(toolName === 'create' ? { newPath: path } : {})
    });
  }

  return mergeDrafts(drafts).map((draft) => ({
    toolId,
    toolName,
    status,
    ...draft
  }));
}

export function isEditToolName(toolName: string): boolean {
  const normalized = normalizeToolName(toolName);
  return (
    EDIT_TOOL_NAMES.has(normalized) ||
    normalized.includes('edit') ||
    normalized.includes('write') ||
    normalized.includes('patch')
  );
}

function parsePatchMarker(text: string): EvidenceDraft[] {
  const lines = text.split(/\r?\n/u);
  const drafts: EvidenceDraft[] = [];
  let current: EvidenceDraft | undefined;
  let oldLines: string[] = [];
  let newLines: string[] = [];

  const finishReplacement = (): void => {
    if (!current || (oldLines.length === 0 && newLines.length === 0)) {
      oldLines = [];
      newLines = [];
      return;
    }
    const replacement = { oldText: oldLines.join('\n'), newText: newLines.join('\n') };
    current.replacements.push(replacement);
    current.oldText ??= replacement.oldText;
    current.newText ??= replacement.newText;
    oldLines = [];
    newLines = [];
  };

  const finishFile = (): void => {
    finishReplacement();
    if (current) {
      drafts.push(current);
      current = undefined;
    }
  };

  for (const line of lines) {
    const header = /^\*\*\*\s+(Add|Update|Delete) File:\s*(.+?)\s*$/u.exec(line);
    if (header) {
      finishFile();
      const path = normalizePath(header[2]);
      if (!path) {
        continue;
      }
      const operation = header[1] === 'Add' ? 'create' : header[1] === 'Delete' ? 'delete' : 'modify';
      current = {
        path,
        operation,
        source: 'patch-marker',
        replacements: [],
        patchText: text,
        ...(operation === 'create' ? { newPath: path } : {}),
        ...(operation === 'delete' ? { oldPath: path } : {})
      };
      continue;
    }

    if (!current) {
      continue;
    }

    const move = /^\*\*\*\s+Move to:\s*(.+?)\s*$/u.exec(line);
    if (move) {
      const newPath = normalizePath(move[1]);
      if (newPath) {
        current.operation = 'rename';
        current.oldPath = current.path;
        current.newPath = newPath;
      }
      continue;
    }

    if (line.startsWith('@@')) {
      finishReplacement();
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      newLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      oldLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith(' ')) {
      const context = line.slice(1);
      oldLines.push(context);
      newLines.push(context);
    }
  }
  finishFile();
  return drafts;
}

function parseUnifiedDiff(text: string): EvidenceDraft[] {
  const lines = text.split(/\r?\n/u);
  const sections: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith('diff --git ') && current.length > 0) {
      sections.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) {
    sections.push(current);
  }

  const drafts: EvidenceDraft[] = [];
  for (const section of sections) {
    let oldPath: string | undefined;
    let newPath: string | undefined;
    let currentOld: string[] = [];
    let currentNew: string[] = [];
    const replacements: ToolTextReplacement[] = [];

    const finishReplacement = (): void => {
      if (currentOld.length > 0 || currentNew.length > 0) {
        replacements.push({ oldText: currentOld.join('\n'), newText: currentNew.join('\n') });
      }
      currentOld = [];
      currentNew = [];
    };

    for (const line of section) {
      const oldHeader = /^---\s+(.+)$/u.exec(line);
      if (oldHeader) {
        oldPath = normalizeDiffPath(oldHeader[1]);
        continue;
      }
      const newHeader = /^\+\+\+\s+(.+)$/u.exec(line);
      if (newHeader) {
        newPath = normalizeDiffPath(newHeader[1]);
        continue;
      }
      if (line.startsWith('@@')) {
        finishReplacement();
        continue;
      }
      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentNew.push(line.slice(1));
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentOld.push(line.slice(1));
      } else if (line.startsWith(' ')) {
        const context = line.slice(1);
        currentOld.push(context);
        currentNew.push(context);
      }
    }
    finishReplacement();

    const path = newPath && newPath !== '/dev/null' ? newPath : oldPath;
    if (!path || path === '/dev/null') {
      continue;
    }
    const operation: ToolEditOperation =
      oldPath === '/dev/null'
        ? 'create'
        : newPath === '/dev/null'
          ? 'delete'
          : oldPath && newPath && oldPath !== newPath
            ? 'rename'
            : 'modify';
    drafts.push({
      path,
      operation,
      source: 'unified-diff',
      oldPath: oldPath && oldPath !== '/dev/null' ? oldPath : undefined,
      newPath: newPath && newPath !== '/dev/null' ? newPath : undefined,
      oldText: replacements[0]?.oldText,
      newText: replacements[0]?.newText,
      replacements,
      unifiedDiff: section.join('\n')
    });
  }
  return drafts;
}

function mergeDrafts(drafts: EvidenceDraft[]): EvidenceDraft[] {
  const merged = new Map<string, EvidenceDraft>();
  for (const draft of drafts) {
    const key = draft.path;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, { ...draft, replacements: [...draft.replacements] });
      continue;
    }

    const replacements = [...previous.replacements];
    for (const replacement of draft.replacements) {
      if (!replacements.some((item) => item.oldText === replacement.oldText && item.newText === replacement.newText)) {
        replacements.push(replacement);
      }
    }
    merged.set(key, {
      ...previous,
      operation: preferOperation(previous.operation, draft.operation),
      source: preferSource(previous.source, draft.source),
      oldPath: previous.oldPath ?? draft.oldPath,
      newPath: previous.newPath ?? draft.newPath,
      oldText: previous.oldText ?? draft.oldText,
      newText: previous.newText ?? draft.newText,
      replacements,
      unifiedDiff: previous.unifiedDiff ?? draft.unifiedDiff,
      patchText: previous.patchText ?? draft.patchText
    });
  }
  return [...merged.values()];
}

function collectCandidateTexts(raw: unknown): string[] {
  const result: string[] = [];
  const seen = new Set<unknown>();

  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) {
      return;
    }
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of DIFF_KEYS) {
      const candidate = record[key];
      if (typeof candidate === 'string' && !result.includes(candidate)) {
        result.push(candidate);
      } else if (candidate && typeof candidate === 'object') {
        visit(candidate);
      }
    }
    visit(record.part);
    visit(record.state);
    visit(record.input);
    visit(record.metadata);
  };

  visit(raw);
  return result;
}

function collectPaths(value: unknown): string[] {
  const paths: string[] = [];
  const seen = new Set<unknown>();

  const visit = (current: unknown): void => {
    if (!current || typeof current !== 'object' || seen.has(current)) {
      return;
    }
    seen.add(current);
    const record = current as Record<string, unknown>;
    for (const key of PATH_KEYS) {
      const path = normalizePath(record[key]);
      if (path && !paths.includes(path)) {
        paths.push(path);
      }
    }
    visit(record.input);
    visit(record.metadata);
    visit(record.state);
    visit(record.part);
    visit(record.edits);
  };

  visit(value);
  return paths;
}

function collectDirectReplacements(value: unknown): ToolTextReplacement[] {
  const replacements: ToolTextReplacement[] = [];
  const seen = new Set<unknown>();

  const visit = (current: unknown): void => {
    if (!current || typeof current !== 'object' || seen.has(current)) {
      return;
    }
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    const record = current as Record<string, unknown>;
    const oldText = pickString(record, OLD_TEXT_KEYS);
    const newText = pickString(record, NEW_TEXT_KEYS);
    if (oldText !== undefined || newText !== undefined) {
      const replacement = { oldText: oldText ?? '', newText: newText ?? '' };
      if (!replacements.some((item) => item.oldText === replacement.oldText && item.newText === replacement.newText)) {
        replacements.push(replacement);
      }
    }
    visit(record.edits);
    visit(record.input);
  };

  visit(value);
  return replacements;
}

function pickToolId(
  root: Record<string, unknown> | null,
  part: Record<string, unknown> | null,
  state: Record<string, unknown> | null
): string | null {
  const candidates = [part?.id, part?.partID, part?.toolCallID, state?.id, state?.toolCallID, root?.id];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function inferDirectOperation(toolName: string, oldText: string | undefined, newText: string | undefined): ToolEditOperation {
  if (toolName === 'create') {
    return 'create';
  }
  if (oldText !== undefined && newText === '') {
    return 'delete';
  }
  return oldText !== undefined || newText !== undefined ? 'modify' : 'unknown';
}

function normalizeStatus(status: string | undefined): ToolEvidenceStatus {
  const normalized = status?.trim().toLowerCase().replace(/[\s-]+/gu, '_') ?? '';
  if (['pending', 'queued', 'waiting'].includes(normalized)) {
    return 'pending';
  }
  if (['running', 'in_progress', 'started'].includes(normalized)) {
    return 'running';
  }
  if (['completed', 'complete', 'success', 'succeeded', 'done'].includes(normalized)) {
    return 'completed';
  }
  if (['error', 'failed', 'failure', 'cancelled', 'canceled', 'stopped'].includes(normalized)) {
    return 'error';
  }
  return 'unknown';
}

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase().replace(/[\s-]+/gu, '_');
}

function normalizePath(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim().replace(/^"|"$/gu, '');
  if (!trimmed || /^https?:\/\//iu.test(trimmed)) {
    return undefined;
  }
  if (trimmed.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname).replace(/^\/([A-Za-z]:)/u, '$1');
    } catch {
      return undefined;
    }
  }
  return trimmed;
}

function normalizeDiffPath(value: string): string | undefined {
  const withoutTimestamp = value.split('\t', 1)[0].trim();
  if (withoutTimestamp === '/dev/null') {
    return '/dev/null';
  }
  const normalized = normalizePath(withoutTimestamp);
  return normalized?.replace(/^[ab]\//u, '');
}

function preferOperation(left: ToolEditOperation, right: ToolEditOperation): ToolEditOperation {
  return operationRank(right) > operationRank(left) ? right : left;
}

function operationRank(operation: ToolEditOperation): number {
  return operation === 'unknown' ? 0 : operation === 'modify' ? 1 : 2;
}

function preferSource(left: ToolEvidenceSource, right: ToolEvidenceSource): ToolEvidenceSource {
  return sourceRank(right) > sourceRank(left) ? right : left;
}

function sourceRank(source: ToolEvidenceSource): number {
  return source === 'input' ? 0 : source === 'unified-diff' ? 1 : 2;
}

function looksLikeUnifiedDiff(text: string): boolean {
  return /(^|\n)(diff --git |---\s.+\n\+\+\+\s|@@\s)/u.test(text);
}

function looksLikePatchMarker(text: string): boolean {
  return /(^|\n)\*\*\* (?:Begin Patch|Add File:|Update File:|Delete File:)/u.test(text);
}

function pickString(record: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    if (typeof record[key] === 'string') {
      return record[key] as string;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
