"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLOCKER_POLL_INTERVAL_MS = void 0;
exports.createServeStreamState = createServeStreamState;
exports.dispatchServeEvent = dispatchServeEvent;
exports.pollServeBlockers = pollServeBlockers;
exports.hasPendingServeBlockers = hasPendingServeBlockers;
exports.delay = delay;
const parsers_1 = require("../bridge/parsers");
exports.BLOCKER_POLL_INTERVAL_MS = 1500;
function createServeStreamState() {
    return {
        assistantMessageIds: new Set(),
        lastAssistantMessageId: null,
        partTextByKey: new Map(),
        partKindByKey: new Map(),
        deltaSeenPartKeys: new Set(),
        pendingDeltaByKey: new Map(),
        pendingPermissionIds: new Set(),
        pendingQuestionIds: new Set(),
    };
}
function dispatchServeEvent(adapter, requestId, sessionId, event, streamState) {
    if (typeof event !== "object" || event === null) {
        return { done: false };
    }
    const record = event;
    const type = typeof record.type === "string" ? record.type : "";
    const properties = typeof record.properties === "object" && record.properties !== null
        ? record.properties
        : {};
    if (type === "permission.asked") {
        const permissionEvent = normalizePermissionRequest(properties);
        if (permissionEvent &&
            adapter.acceptBlockerSession(requestId, sessionId, permissionEvent.sessionId)) {
            surfacePendingPermission(adapter, requestId, permissionEvent, streamState);
        }
        return { done: false };
    }
    if (type === "question.asked") {
        const questionEvent = normalizeQuestionRequest(properties);
        if (questionEvent &&
            adapter.acceptBlockerSession(requestId, sessionId, questionEvent.sessionId)) {
            surfacePendingQuestion(adapter, requestId, questionEvent, streamState);
        }
        return { done: false };
    }
    if (type === "permission.replied") {
        if (adapter.acceptBlockerSession(requestId, sessionId, typeof properties.sessionID === "string"
            ? properties.sessionID
            : undefined) &&
            typeof properties.requestID === "string") {
            streamState.pendingPermissionIds.delete(properties.requestID);
            adapter.setPendingPermission(undefined);
        }
        return { done: false };
    }
    if (type === "question.replied" || type === "question.rejected") {
        if (adapter.acceptBlockerSession(requestId, sessionId, typeof properties.sessionID === "string"
            ? properties.sessionID
            : undefined) &&
            typeof properties.requestID === "string") {
            streamState.pendingQuestionIds.delete(properties.requestID);
            adapter.setPendingQuestion(undefined);
        }
        return { done: false };
    }
    if (type === "message.updated") {
        const info = typeof properties.info === "object" && properties.info !== null
            ? properties.info
            : null;
        if (!info || info.sessionID !== sessionId || info.role !== "assistant") {
            return { done: false };
        }
        const messageId = typeof info.id === "string" ? info.id : null;
        if (messageId) {
            streamState.assistantMessageIds.add(messageId);
            streamState.lastAssistantMessageId = messageId;
        }
        if (messageId &&
            typeof info.finish === "string" &&
            !["tool-calls", "unknown"].includes(info.finish) &&
            !hasPendingServeBlockers(streamState)) {
            return { done: true };
        }
        return { done: false };
    }
    if (type === "session.error") {
        if (properties.sessionID === sessionId) {
            const message = extractEventErrorMessage(properties.error) ?? "运行失败。";
            adapter.emit({ type: "error", error: message });
            return { done: true };
        }
        return { done: false };
    }
    if (type === "message.part.delta") {
        const deltaPart = toTokenDeltaServePart(properties, sessionId, streamState);
        if (deltaPart) {
            adapter.emit({ type: "part", part: deltaPart });
        }
        return { done: false };
    }
    if (type === "message.part.updated") {
        const part = typeof properties.part === "object" && properties.part !== null
            ? properties.part
            : null;
        if (!part || part.sessionID !== sessionId) {
            return { done: false };
        }
        const partRecord = part;
        const messageId = typeof partRecord.messageID === "string" ? partRecord.messageID : null;
        if (!isAssistantPartMessage(messageId, streamState)) {
            return { done: false };
        }
        const parsed = (0, parsers_1.parseRunEvent)({ part });
        if (parsed?.type === "part") {
            const incrementalPart = toIncrementalServePart(partRecord, parsed.part, streamState);
            if (incrementalPart) {
                adapter.emit({ type: "part", part: incrementalPart });
            }
        }
        return { done: false };
    }
    if (type === "session.status") {
        const status = typeof properties.status === "object" && properties.status !== null
            ? properties.status
            : null;
        if (properties.sessionID === sessionId &&
            status?.type === "idle" &&
            streamState.lastAssistantMessageId &&
            !hasPendingServeBlockers(streamState)) {
            return { done: true };
        }
    }
    return { done: false };
}
async function pollServeBlockers(adapter, requestId, sessionId, streamState) {
    if (!adapter.isCurrentRun(requestId)) {
        return 0;
    }
    const [permissionsResult, questionsResult, sessionsResult] = await Promise.allSettled([
        adapter.requestServeJson("/permission"),
        adapter.requestServeJson("/question"),
        adapter.requestServeJson("/session"),
    ]);
    let surfaced = 0;
    const sessions = sessionsResult.status === "fulfilled"
        ? normalizeSessionTree(sessionsResult.value)
        : [];
    const permissions = permissionsResult.status === "fulfilled"
        ? normalizePermissionRequestList(permissionsResult.value)
        : [];
    const questions = questionsResult.status === "fulfilled"
        ? normalizeQuestionRequestList(questionsResult.value)
        : [];
    reconcilePendingPermissions(adapter, permissions, streamState);
    reconcilePendingQuestions(adapter, questions, streamState);
    const permission = pickCurrentRunBlocker(permissions, sessionId, sessions);
    if (permission &&
        surfacePendingPermission(adapter, requestId, permission, streamState)) {
        surfaced += 1;
    }
    const question = pickCurrentRunBlocker(questions, sessionId, sessions);
    if (question &&
        surfacePendingQuestion(adapter, requestId, question, streamState)) {
        surfaced += 1;
    }
    return surfaced;
}
function hasPendingServeBlockers(streamState) {
    return (streamState.pendingPermissionIds.size > 0 ||
        streamState.pendingQuestionIds.size > 0);
}
function delay(ms, signal) {
    if (signal?.aborted) {
        return Promise.reject(createAbortError());
    }
    return new Promise((resolve, reject) => {
        const cleanup = () => signal?.removeEventListener("abort", abort);
        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        const abort = () => {
            clearTimeout(timer);
            cleanup();
            reject(createAbortError());
        };
        signal?.addEventListener("abort", abort, { once: true });
    });
}
function reconcilePendingPermissions(adapter, permissions, streamState) {
    const activeIds = new Set(permissions.map((item) => item.permissionId));
    for (const id of [...streamState.pendingPermissionIds]) {
        if (activeIds.has(id)) {
            continue;
        }
        streamState.pendingPermissionIds.delete(id);
        adapter.setPendingPermission(undefined);
    }
}
function reconcilePendingQuestions(adapter, questions, streamState) {
    const activeIds = new Set(questions.map((item) => item.questionId));
    for (const id of [...streamState.pendingQuestionIds]) {
        if (activeIds.has(id)) {
            continue;
        }
        streamState.pendingQuestionIds.delete(id);
        adapter.setPendingQuestion(undefined);
    }
}
function surfacePendingPermission(adapter, requestId, event, streamState) {
    adapter.setPendingPermission(event);
    if (streamState.pendingPermissionIds.has(event.permissionId)) {
        return false;
    }
    streamState.pendingPermissionIds.add(event.permissionId);
    adapter.emit(event);
    return true;
}
function surfacePendingQuestion(adapter, requestId, event, streamState) {
    adapter.setPendingQuestion(event);
    if (streamState.pendingQuestionIds.has(event.questionId)) {
        return false;
    }
    streamState.pendingQuestionIds.add(event.questionId);
    adapter.emit(event);
    return true;
}
function normalizeQuestionInfoList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item) => {
        if (typeof item !== "object" || item === null) {
            return [];
        }
        const record = item;
        if (typeof record.header !== "string" ||
            typeof record.question !== "string" ||
            !Array.isArray(record.options)) {
            return [];
        }
        const options = record.options.flatMap((option) => {
            if (typeof option !== "object" || option === null) {
                return [];
            }
            const optionRecord = option;
            if (typeof optionRecord.label !== "string" ||
                typeof optionRecord.description !== "string") {
                return [];
            }
            return [
                {
                    label: optionRecord.label,
                    description: optionRecord.description,
                },
            ];
        });
        return [
            {
                header: record.header,
                question: record.question,
                options,
                multiple: typeof record.multiple === "boolean" ? record.multiple : undefined,
                custom: typeof record.custom === "boolean" ? record.custom : undefined,
            },
        ];
    });
}
function normalizePermissionRequestList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item) => {
        const event = normalizePermissionRequest(item);
        return event ? [event] : [];
    });
}
function normalizePermissionRequest(value) {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const record = value;
    if (typeof record.id !== "string" || typeof record.sessionID !== "string") {
        return null;
    }
    return {
        type: "permission",
        permissionId: record.id,
        sessionId: record.sessionID,
        toolName: typeof record.permission === "string" ? record.permission : "tool",
        patterns: Array.isArray(record.patterns)
            ? record.patterns.filter((item) => typeof item === "string")
            : [],
        message: getPermissionRequestMessage(record),
    };
}
function getPermissionRequestMessage(record) {
    if (typeof record.message === "string") {
        return record.message;
    }
    const metadata = typeof record.metadata === "object" && record.metadata !== null
        ? record.metadata
        : null;
    if (typeof metadata?.description === "string") {
        return metadata.description;
    }
    if (typeof metadata?.filepath === "string") {
        return metadata.filepath;
    }
    return undefined;
}
function normalizeQuestionRequestList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item) => {
        const event = normalizeQuestionRequest(item);
        return event ? [event] : [];
    });
}
function normalizeQuestionRequest(value) {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const record = value;
    if (typeof record.id !== "string" || typeof record.sessionID !== "string") {
        return null;
    }
    const questions = normalizeQuestionInfoList(record.questions);
    if (questions.length === 0) {
        return null;
    }
    return {
        type: "question",
        questionId: record.id,
        sessionId: record.sessionID,
        questions,
    };
}
function normalizeSessionTree(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item) => {
        if (typeof item !== "object" || item === null) {
            return [];
        }
        const record = item;
        if (typeof record.id !== "string") {
            return [];
        }
        return [
            {
                id: record.id,
                parentId: typeof record.parentID === "string" ? record.parentID : undefined,
            },
        ];
    });
}
function pickCurrentRunBlocker(events, sessionId, sessions) {
    if (events.length === 0) {
        return undefined;
    }
    const sessionIds = getSessionTreeIds(sessionId, sessions);
    return events.find((event) => sessionIds.has(event.sessionId)) ?? events[0];
}
function getSessionTreeIds(sessionId, sessions) {
    const childrenByParent = new Map();
    for (const session of sessions) {
        if (!session.parentId) {
            continue;
        }
        const children = childrenByParent.get(session.parentId);
        if (children) {
            children.push(session.id);
        }
        else {
            childrenByParent.set(session.parentId, [session.id]);
        }
    }
    const result = new Set([sessionId]);
    const queue = [sessionId];
    for (const current of queue) {
        const children = childrenByParent.get(current) ?? [];
        for (const child of children) {
            if (result.has(child)) {
                continue;
            }
            result.add(child);
            queue.push(child);
        }
    }
    return result;
}
function createAbortError() {
    const error = new Error("Aborted");
    error.name = "AbortError";
    return error;
}
function toTokenDeltaServePart(properties, sessionId, streamState) {
    if (properties.sessionID !== sessionId ||
        properties.field !== "text" ||
        typeof properties.delta !== "string" ||
        properties.delta.length === 0) {
        return null;
    }
    const messageId = typeof properties.messageID === "string" ? properties.messageID : null;
    const partId = typeof properties.partID === "string" ? properties.partID : null;
    if (!partId || !isAssistantPartMessage(messageId, streamState)) {
        return null;
    }
    const partKey = getServePartKey({
        messageID: messageId ?? undefined,
        id: partId,
        type: "text",
    });
    const kind = streamState.partKindByKey.get(partKey);
    if (!kind) {
        const previous = streamState.pendingDeltaByKey.get(partKey) ?? "";
        streamState.pendingDeltaByKey.set(partKey, `${previous}${properties.delta}`);
        return null;
    }
    streamState.deltaSeenPartKeys.add(partKey);
    streamState.partTextByKey.set(partKey, `${streamState.partTextByKey.get(partKey) ?? ""}${properties.delta}`);
    if (kind === "text") {
        return {
            type: "text",
            text: properties.delta,
        };
    }
    return {
        type: "reasoning",
        text: properties.delta,
    };
}
function isAssistantPartMessage(messageId, streamState) {
    if (!messageId) {
        return streamState.lastAssistantMessageId !== null;
    }
    return (streamState.assistantMessageIds.has(messageId) ||
        streamState.lastAssistantMessageId === messageId);
}
function toIncrementalServePart(partRecord, parsedPart, streamState) {
    if (parsedPart.type !== "text" && parsedPart.type !== "reasoning") {
        return parsedPart;
    }
    const partKey = getServePartKey(partRecord);
    streamState.partKindByKey.set(partKey, parsedPart.type);
    const pendingDelta = streamState.pendingDeltaByKey.get(partKey);
    if (pendingDelta !== undefined) {
        streamState.pendingDeltaByKey.delete(partKey);
        streamState.deltaSeenPartKeys.add(partKey);
        streamState.partTextByKey.set(partKey, pendingDelta);
        if (pendingDelta.length > 0) {
            if (parsedPart.type === "text") {
                return {
                    type: "text",
                    text: pendingDelta,
                };
            }
            return {
                type: "reasoning",
                text: pendingDelta,
                raw: parsedPart.raw,
            };
        }
    }
    const previousText = streamState.partTextByKey.get(partKey) ?? "";
    const currentText = parsedPart.text;
    streamState.partTextByKey.set(partKey, currentText);
    if (streamState.deltaSeenPartKeys.has(partKey)) {
        if (currentText.length < previousText.length ||
            !currentText.startsWith(previousText)) {
            streamState.deltaSeenPartKeys.delete(partKey);
        }
        else {
            return null;
        }
    }
    const nextText = currentText.startsWith(previousText)
        ? currentText.slice(previousText.length)
        : currentText;
    if (nextText.length === 0) {
        return null;
    }
    if (parsedPart.type === "text") {
        return {
            type: "text",
            text: nextText,
        };
    }
    return {
        type: "reasoning",
        text: nextText,
        raw: parsedPart.raw,
    };
}
function getServePartKey(partRecord) {
    const messageId = typeof partRecord.messageID === "string" ? partRecord.messageID : "message";
    const partId = typeof partRecord.id === "string" ? partRecord.id : undefined;
    if (partId) {
        return `${messageId}:${partId}`;
    }
    const type = typeof partRecord.type === "string" ? partRecord.type : "part";
    return `${messageId}:${type}`;
}
function extractEventErrorMessage(value) {
    if (typeof value === "string") {
        return stripAnsi(value).trim() || null;
    }
    if (!isRecord(value)) {
        return null;
    }
    const direct = [value.message, value.text, value.name]
        .map((entry) => (typeof entry === "string" ? stripAnsi(entry).trim() : ""))
        .find((entry) => entry.length > 0);
    if (direct) {
        return direct;
    }
    return (extractEventErrorMessage(value.data) ??
        extractEventErrorMessage(value.error) ??
        null);
}
function stripAnsi(value) {
    return value.replace(new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"), "");
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
//# sourceMappingURL=runLifecycle.js.map