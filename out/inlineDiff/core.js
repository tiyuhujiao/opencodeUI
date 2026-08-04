"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InlineDiffConflictError = void 0;
exports.createTextSnapshot = createTextSnapshot;
exports.buildHunks = buildHunks;
exports.applyAcceptHunkToBaseline = applyAcceptHunkToBaseline;
exports.applyRejectHunkToCurrent = applyRejectHunkToCurrent;
exports.hashText = hashText;
class InlineDiffConflictError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'InlineDiffConflictError';
        this.code = code;
    }
}
exports.InlineDiffConflictError = InlineDiffConflictError;
const FINAL_NEWLINE_TOKEN = '\u0000inline-diff-final-newline';
const DEFAULT_MERGE_DISTANCE = 3;
const DEFAULT_MAX_EDIT_DISTANCE = 2048;
function createTextSnapshot(text) {
    const firstEol = /\r\n|\n/u.exec(text)?.[0];
    const tokens = tokenizeLines(text);
    return {
        text,
        eol: firstEol === '\r\n' ? '\r\n' : '\n',
        hasFinalNewline: /(?:\r\n|\n)$/u.test(text),
        hash: hashText(text),
        lineCount: tokens.reduce((count, token) => count + (token.isFinalNewline ? 0 : 1), 0)
    };
}
function buildHunks(baselineInput, currentInput, options = {}) {
    const baseline = toSnapshot(baselineInput);
    const current = toSnapshot(currentInput);
    const beforeTokens = tokenizeLines(baseline.text);
    const afterTokens = tokenizeLines(current.text);
    const beforeKeys = beforeTokens.map((token) => token.key);
    const afterKeys = afterTokens.map((token) => token.key);
    if (arraysEqual(beforeKeys, afterKeys)) {
        return [];
    }
    const maxEditDistance = normalizeNonNegativeInteger(options.maxEditDistance, DEFAULT_MAX_EDIT_DISTANCE);
    const steps = buildMyersSteps(beforeKeys, afterKeys, maxEditDistance);
    const changes = steps
        ? mergeChanges(collectChanges(steps, beforeTokens, afterTokens), normalizeNonNegativeInteger(options.mergeDistance, DEFAULT_MERGE_DISTANCE))
        : [wholeDocumentChange(beforeTokens, afterTokens)];
    return changes.map((change) => makeHunk(change, baseline, current, beforeTokens, afterTokens));
}
function applyAcceptHunkToBaseline(baselineInput, currentInput, hunk) {
    const baseline = toSnapshot(baselineInput);
    const current = toSnapshot(currentInput);
    assertHunkMatchesSnapshots(baseline, current, hunk);
    const nextText = baseline.text.slice(0, hunk.beforeStartOffset) +
        hunk.afterText +
        baseline.text.slice(hunk.beforeEndOffset);
    return createTextSnapshot(nextText);
}
function applyRejectHunkToCurrent(baselineInput, currentInput, hunk) {
    const baseline = toSnapshot(baselineInput);
    const current = toSnapshot(currentInput);
    assertHunkMatchesSnapshots(baseline, current, hunk);
    const nextText = current.text.slice(0, hunk.afterStartOffset) +
        hunk.beforeText +
        current.text.slice(hunk.afterEndOffset);
    return createTextSnapshot(nextText);
}
function hashText(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        hash ^= code & 0xff;
        hash = Math.imul(hash, 0x01000193);
        hash ^= code >>> 8;
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
function toSnapshot(input) {
    return typeof input === 'string' ? createTextSnapshot(input) : input;
}
function tokenizeLines(text) {
    if (text.length === 0) {
        return [];
    }
    const tokens = [];
    const newlinePattern = /\r\n|\n/gu;
    let lineStart = 0;
    let match = newlinePattern.exec(text);
    while (match !== null) {
        const newlineStart = match.index;
        const newlineEnd = newlinePattern.lastIndex;
        const content = text.slice(lineStart, newlineStart);
        const isFinalNewline = newlineEnd === text.length;
        tokens.push({
            key: content,
            startOffset: lineStart,
            endOffset: isFinalNewline ? newlineStart : newlineEnd,
            isFinalNewline: false
        });
        if (isFinalNewline) {
            tokens.push({
                key: FINAL_NEWLINE_TOKEN,
                startOffset: newlineStart,
                endOffset: newlineEnd,
                isFinalNewline: true
            });
        }
        lineStart = newlineEnd;
        match = newlinePattern.exec(text);
    }
    if (lineStart < text.length) {
        tokens.push({
            key: text.slice(lineStart),
            startOffset: lineStart,
            endOffset: text.length,
            isFinalNewline: false
        });
    }
    return tokens;
}
function buildMyersSteps(before, after, maxEditDistance) {
    const beforeLength = before.length;
    const afterLength = after.length;
    const maximum = beforeLength + afterLength;
    const distanceLimit = Math.min(maximum, maxEditDistance);
    const trace = [];
    const furthest = new Map([[1, 0]]);
    for (let distance = 0; distance <= distanceLimit; distance += 1) {
        trace.push(new Map(furthest));
        for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
            const down = furthest.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
            const right = furthest.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY;
            let beforeIndex;
            if (diagonal === -distance || (diagonal !== distance && right < down)) {
                beforeIndex = down;
            }
            else {
                beforeIndex = right + 1;
            }
            let afterIndex = beforeIndex - diagonal;
            while (beforeIndex < beforeLength &&
                afterIndex < afterLength &&
                before[beforeIndex] === after[afterIndex]) {
                beforeIndex += 1;
                afterIndex += 1;
            }
            furthest.set(diagonal, beforeIndex);
            if (beforeIndex >= beforeLength && afterIndex >= afterLength) {
                return backtrackMyers(trace, before, after, distance);
            }
        }
    }
    return null;
}
function backtrackMyers(trace, before, after, distance) {
    const reversed = [];
    let beforeIndex = before.length;
    let afterIndex = after.length;
    for (let currentDistance = distance; currentDistance > 0; currentDistance -= 1) {
        const previous = trace[currentDistance];
        const diagonal = beforeIndex - afterIndex;
        const down = previous.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
        const right = previous.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY;
        const previousDiagonal = diagonal === -currentDistance || (diagonal !== currentDistance && right < down)
            ? diagonal + 1
            : diagonal - 1;
        const previousBeforeIndex = previous.get(previousDiagonal) ?? 0;
        const previousAfterIndex = previousBeforeIndex - previousDiagonal;
        while (beforeIndex > previousBeforeIndex && afterIndex > previousAfterIndex) {
            beforeIndex -= 1;
            afterIndex -= 1;
            reversed.push({ kind: 'equal', beforeIndex, afterIndex });
        }
        if (beforeIndex === previousBeforeIndex) {
            afterIndex -= 1;
            reversed.push({ kind: 'insert', afterIndex });
        }
        else {
            beforeIndex -= 1;
            reversed.push({ kind: 'delete', beforeIndex });
        }
    }
    while (beforeIndex > 0 && afterIndex > 0) {
        beforeIndex -= 1;
        afterIndex -= 1;
        reversed.push({ kind: 'equal', beforeIndex, afterIndex });
    }
    while (beforeIndex > 0) {
        beforeIndex -= 1;
        reversed.push({ kind: 'delete', beforeIndex });
    }
    while (afterIndex > 0) {
        afterIndex -= 1;
        reversed.push({ kind: 'insert', afterIndex });
    }
    return reversed.reverse();
}
function collectChanges(steps, beforeTokens, afterTokens) {
    const changes = [];
    let beforeIndex = 0;
    let afterIndex = 0;
    let active;
    const finishActive = () => {
        if (active) {
            changes.push(active);
            active = undefined;
        }
    };
    for (const step of steps) {
        if (step.kind === 'equal') {
            finishActive();
            beforeIndex += 1;
            afterIndex += 1;
            continue;
        }
        active ?? (active = {
            beforeStartToken: beforeIndex,
            beforeEndToken: beforeIndex,
            afterStartToken: afterIndex,
            afterEndToken: afterIndex,
            additions: 0,
            deletions: 0
        });
        if (step.kind === 'delete') {
            if (!beforeTokens[beforeIndex]?.isFinalNewline) {
                active.deletions += 1;
            }
            beforeIndex += 1;
            active.beforeEndToken = beforeIndex;
        }
        else {
            if (!afterTokens[afterIndex]?.isFinalNewline) {
                active.additions += 1;
            }
            afterIndex += 1;
            active.afterEndToken = afterIndex;
        }
    }
    finishActive();
    return changes;
}
function mergeChanges(changes, mergeDistance) {
    const merged = [];
    for (const change of changes) {
        const previous = merged.at(-1);
        if (previous &&
            change.beforeStartToken - previous.beforeEndToken <= mergeDistance &&
            change.afterStartToken - previous.afterEndToken <= mergeDistance) {
            previous.beforeEndToken = change.beforeEndToken;
            previous.afterEndToken = change.afterEndToken;
            previous.additions += change.additions;
            previous.deletions += change.deletions;
            continue;
        }
        merged.push({ ...change });
    }
    return merged;
}
function wholeDocumentChange(beforeTokens, afterTokens) {
    return {
        beforeStartToken: 0,
        beforeEndToken: beforeTokens.length,
        afterStartToken: 0,
        afterEndToken: afterTokens.length,
        additions: countContentTokens(afterTokens),
        deletions: countContentTokens(beforeTokens)
    };
}
function makeHunk(change, baseline, current, beforeTokens, afterTokens) {
    const beforeStartOffset = tokenBoundary(beforeTokens, change.beforeStartToken, baseline.text.length);
    const beforeEndOffset = tokenBoundary(beforeTokens, change.beforeEndToken, baseline.text.length);
    const afterStartOffset = tokenBoundary(afterTokens, change.afterStartToken, current.text.length);
    const afterEndOffset = tokenBoundary(afterTokens, change.afterEndToken, current.text.length);
    const beforeText = baseline.text.slice(beforeStartOffset, beforeEndOffset);
    const afterText = current.text.slice(afterStartOffset, afterEndOffset);
    const kind = change.deletions === 0 ? 'insert' : change.additions === 0 ? 'delete' : 'replace';
    const identity = [
        baseline.hash,
        current.hash,
        String(beforeStartOffset),
        String(beforeEndOffset),
        String(afterStartOffset),
        String(afterEndOffset),
        beforeText,
        afterText
    ].join('\u0000');
    return {
        id: `hunk-${hashText(identity)}`,
        kind,
        beforeStartLine: contentTokensBefore(beforeTokens, change.beforeStartToken),
        beforeEndLine: contentTokensBefore(beforeTokens, change.beforeEndToken),
        afterStartLine: contentTokensBefore(afterTokens, change.afterStartToken),
        afterEndLine: contentTokensBefore(afterTokens, change.afterEndToken),
        beforeStartOffset,
        beforeEndOffset,
        afterStartOffset,
        afterEndOffset,
        beforeText,
        afterText,
        additions: change.additions,
        deletions: change.deletions,
        baselineHash: baseline.hash,
        currentHash: current.hash
    };
}
function tokenBoundary(tokens, tokenIndex, textLength) {
    if (tokenIndex <= 0) {
        return 0;
    }
    if (tokenIndex >= tokens.length) {
        return textLength;
    }
    return tokens[tokenIndex].startOffset;
}
function contentTokensBefore(tokens, tokenIndex) {
    let count = 0;
    for (let index = 0; index < Math.min(tokenIndex, tokens.length); index += 1) {
        if (!tokens[index].isFinalNewline) {
            count += 1;
        }
    }
    return count;
}
function countContentTokens(tokens) {
    return tokens.reduce((count, token) => count + (token.isFinalNewline ? 0 : 1), 0);
}
function assertHunkMatchesSnapshots(baseline, current, hunk) {
    if (baseline.hash !== hunk.baselineHash || current.hash !== hunk.currentHash) {
        throw new InlineDiffConflictError('STALE_DOCUMENT', 'The inline diff hunk was built for an older document revision.');
    }
    if (hunk.beforeStartOffset < 0 ||
        hunk.beforeEndOffset < hunk.beforeStartOffset ||
        hunk.beforeEndOffset > baseline.text.length ||
        hunk.afterStartOffset < 0 ||
        hunk.afterEndOffset < hunk.afterStartOffset ||
        hunk.afterEndOffset > current.text.length ||
        baseline.text.slice(hunk.beforeStartOffset, hunk.beforeEndOffset) !== hunk.beforeText ||
        current.text.slice(hunk.afterStartOffset, hunk.afterEndOffset) !== hunk.afterText) {
        throw new InlineDiffConflictError('INVALID_HUNK', 'The inline diff hunk does not match its source snapshots.');
    }
}
function arraysEqual(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
function normalizeNonNegativeInteger(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
}
//# sourceMappingURL=core.js.map