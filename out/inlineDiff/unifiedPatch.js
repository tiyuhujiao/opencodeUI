"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnifiedPatchError = void 0;
exports.reverseUnifiedPatch = reverseUnifiedPatch;
class UnifiedPatchError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UnifiedPatchError';
    }
}
exports.UnifiedPatchError = UnifiedPatchError;
function reverseUnifiedPatch(currentText, patchText, options) {
    const parsed = parseUnifiedPatch(patchText);
    const current = splitText(currentText);
    const beforeLines = [...current.lines];
    if (parsed.afterExists !== options.currentExists) {
        throw new UnifiedPatchError('The patch file state no longer matches the workspace.');
    }
    for (let index = parsed.hunks.length - 1; index >= 0; index -= 1) {
        const hunk = parsed.hunks[index];
        const after = hunk.lines
            .filter((line) => line.kind !== 'remove')
            .map((line) => line.text);
        const before = hunk.lines
            .filter((line) => line.kind !== 'add')
            .map((line) => line.text);
        const start = hunk.newCount === 0 ? hunk.newStart : Math.max(0, hunk.newStart - 1);
        const actual = beforeLines.slice(start, start + after.length);
        if (!sameLines(actual, after)) {
            throw new UnifiedPatchError(`Patch hunk at new line ${String(hunk.newStart)} does not match the current file.`);
        }
        beforeLines.splice(start, after.length, ...before);
    }
    const oldNoFinalNewline = parsed.hunks.some((hunk) => hunk.lines.some((line) => line.noFinalNewline && line.kind !== 'add'));
    const newNoFinalNewline = parsed.hunks.some((hunk) => hunk.lines.some((line) => line.noFinalNewline && line.kind !== 'remove'));
    const beforeHasFinalNewline = oldNoFinalNewline
        ? false
        : newNoFinalNewline
            ? true
            : beforeLines.length > 0 && current.lines.length === 0
                ? true
                : current.hasFinalNewline;
    return {
        beforeText: parsed.beforeExists
            ? joinText(beforeLines, current.eol, beforeHasFinalNewline)
            : '',
        beforeExists: parsed.beforeExists,
        afterExists: parsed.afterExists
    };
}
function parseUnifiedPatch(patchText) {
    const lines = patchText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const oldHeader = lines.find((line) => line.startsWith('--- '));
    const newHeader = lines.find((line) => line.startsWith('+++ '));
    const hunks = [];
    for (let index = 0; index < lines.length; index += 1) {
        const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[index]);
        if (!match) {
            continue;
        }
        const hunk = {
            oldStart: Number(match[1]),
            oldCount: match[2] === undefined ? 1 : Number(match[2]),
            newStart: Number(match[3]),
            newCount: match[4] === undefined ? 1 : Number(match[4]),
            lines: []
        };
        for (index += 1; index < lines.length; index += 1) {
            const line = lines[index];
            if (line.startsWith('@@ ')) {
                index -= 1;
                break;
            }
            if (line === '\\ No newline at end of file') {
                const previous = hunk.lines[hunk.lines.length - 1];
                if (!previous) {
                    throw new UnifiedPatchError('A no-newline marker appeared before any patch content.');
                }
                previous.noFinalNewline = true;
                continue;
            }
            const prefix = line[0];
            if (prefix !== ' ' && prefix !== '-' && prefix !== '+') {
                index -= 1;
                break;
            }
            hunk.lines.push({
                kind: prefix === ' ' ? 'context' : prefix === '-' ? 'remove' : 'add',
                text: line.slice(1),
                noFinalNewline: false
            });
        }
        const observedOld = hunk.lines.filter((line) => line.kind !== 'add').length;
        const observedNew = hunk.lines.filter((line) => line.kind !== 'remove').length;
        if (observedOld !== hunk.oldCount || observedNew !== hunk.newCount) {
            throw new UnifiedPatchError(`Patch hunk counts do not match its content (${String(observedOld)}/${String(hunk.oldCount)}, ${String(observedNew)}/${String(hunk.newCount)}).`);
        }
        hunks.push(hunk);
    }
    if (hunks.length === 0) {
        throw new UnifiedPatchError('The canonical patch did not contain any unified diff hunks.');
    }
    const first = hunks[0];
    const beforeExists = oldHeader
        ? !isNullDeviceHeader(oldHeader)
        : !(first.oldStart === 0 && hunks.every((hunk) => hunk.oldCount === 0));
    const afterExists = newHeader
        ? !isNullDeviceHeader(newHeader)
        : !(first.newStart === 0 && hunks.every((hunk) => hunk.newCount === 0));
    return { hunks, beforeExists, afterExists };
}
function isNullDeviceHeader(header) {
    const value = header.slice(4).split('\t', 1)[0].trim();
    return value === '/dev/null' || value.toLowerCase() === 'nul';
}
function splitText(text) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const normalized = text.replace(/\r\n/g, '\n');
    const hasFinalNewline = normalized.endsWith('\n');
    if (normalized.length === 0) {
        return { lines: [], eol, hasFinalNewline: false };
    }
    return {
        lines: (hasFinalNewline ? normalized.slice(0, -1) : normalized).split('\n'),
        eol,
        hasFinalNewline
    };
}
function joinText(lines, eol, hasFinalNewline) {
    if (lines.length === 0) {
        return hasFinalNewline ? eol : '';
    }
    return `${lines.join(eol)}${hasFinalNewline ? eol : ''}`;
}
function sameLines(left, right) {
    return left.length === right.length && left.every((line, index) => line === right[index]);
}
//# sourceMappingURL=unifiedPatch.js.map