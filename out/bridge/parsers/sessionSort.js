"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortSessionsByUpdatedDesc = sortSessionsByUpdatedDesc;
exports.mergeSessionsById = mergeSessionsById;
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