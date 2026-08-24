"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortSessionsByUpdatedDesc = sortSessionsByUpdatedDesc;
exports.mergeSessionsById = mergeSessionsById;
exports.filterSessionsByDirectory = filterSessionsByDirectory;
const node_path_1 = require("node:path");
function sortSessionsByUpdatedDesc(sessions) {
    return sessions.slice().sort((a, b) => compareUpdatedDesc(a.updated, b.updated));
}
function mergeSessionsById(sessionLists) {
    const merged = new Map();
    for (const sessions of sessionLists) {
        for (const session of sessions) {
            const existing = merged.get(session.id);
            if (!existing || compareUpdatedDesc(session.updated, existing.updated) < 0) {
                merged.set(session.id, session);
            }
        }
    }
    return [...merged.values()];
}
function filterSessionsByDirectory(sessions, directory, platform = process.platform) {
    const expected = normalizeDirectory(directory, platform);
    return sessions.filter((session) => normalizeDirectory(session.directory, platform) === expected);
}
function normalizeDirectory(directory, platform) {
    if (platform === 'win32') {
        return trimTrailingSeparators(node_path_1.win32.normalize(directory.replace(/\//g, '\\')), '\\').toLowerCase();
    }
    return trimTrailingSeparators(node_path_1.posix.normalize(directory), '/');
}
function trimTrailingSeparators(directory, separator) {
    const rootLength = separator === '\\'
        ? node_path_1.win32.parse(directory).root.length
        : node_path_1.posix.parse(directory).root.length;
    let end = directory.length;
    while (end > rootLength && directory[end - 1] === separator) {
        end -= 1;
    }
    return directory.slice(0, end);
}
function compareUpdatedDesc(left, right) {
    const leftTs = Date.parse(left);
    const rightTs = Date.parse(right);
    const leftValid = Number.isFinite(leftTs);
    const rightValid = Number.isFinite(rightTs);
    if (leftValid && rightValid) {
        return rightTs - leftTs;
    }
    if (leftValid && !rightValid) {
        return -1;
    }
    if (!leftValid && rightValid) {
        return 1;
    }
    return right.localeCompare(left);
}
//# sourceMappingURL=sessionSort.js.map