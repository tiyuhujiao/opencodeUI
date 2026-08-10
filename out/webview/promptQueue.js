"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PROMPT_QUEUE_ITEMS = void 0;
exports.createQueuedPrompt = createQueuedPrompt;
exports.createOpencodeMessageId = createOpencodeMessageId;
exports.toRunQueueState = toRunQueueState;
exports.updateQueuedPromptMessage = updateQueuedPromptMessage;
exports.removeQueuedPrompt = removeQueuedPrompt;
exports.cloneRunPromptPayload = cloneRunPromptPayload;
const node_crypto_1 = require("node:crypto");
exports.MAX_PROMPT_QUEUE_ITEMS = 100;
const OPENCODE_ID_RANDOM_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const OPENCODE_ID_RANDOM_LENGTH = 14;
let lastMessageIdTimestamp = 0;
let messageIdCounter = 0;
function createQueuedPrompt(id, createdAt, payload) {
    return {
        id,
        createdAt,
        payload: cloneRunPromptPayload(payload),
        delivery: "queued",
        messageId: createOpencodeMessageId(createdAt),
    };
}
function createOpencodeMessageId(timestamp = Date.now()) {
    if (timestamp !== lastMessageIdTimestamp) {
        lastMessageIdTimestamp = timestamp;
        messageIdCounter = 0;
    }
    messageIdCounter += 1;
    const encodedTime = BigInt(timestamp) * 0x1000n + BigInt(messageIdCounter);
    const timeHex = encodedTime.toString(16).padStart(12, "0").slice(-12);
    const random = (0, node_crypto_1.randomBytes)(OPENCODE_ID_RANDOM_LENGTH);
    let suffix = "";
    for (const value of random) {
        suffix += OPENCODE_ID_RANDOM_ALPHABET[value % OPENCODE_ID_RANDOM_ALPHABET.length];
    }
    return `msg_${timeHex}${suffix}`;
}
function toRunQueueState(queue) {
    return {
        items: queue.map(toSummary),
    };
}
function updateQueuedPromptMessage(queue, id, message) {
    const trimmed = message.trim();
    const index = queue.findIndex((item) => item.id === id);
    if (index < 0 || !trimmed) {
        return null;
    }
    return queue.map((item, itemIndex) => itemIndex === index
        ? {
            ...item,
            payload: {
                ...cloneRunPromptPayload(item.payload),
                message: trimmed,
            },
        }
        : cloneQueuedPrompt(item));
}
function removeQueuedPrompt(queue, id) {
    const removed = queue.find((item) => item.id === id);
    if (!removed) {
        return null;
    }
    return {
        queue: queue
            .filter((item) => item.id !== id)
            .map(cloneQueuedPrompt),
        removed: cloneQueuedPrompt(removed),
    };
}
function cloneRunPromptPayload(payload) {
    return {
        ...payload,
        ...(payload.files ? { files: [...payload.files] } : {}),
        ...(payload.command ? { command: { ...payload.command } } : {}),
    };
}
function cloneQueuedPrompt(item) {
    return {
        ...item,
        payload: cloneRunPromptPayload(item.payload),
    };
}
function toSummary(item) {
    return {
        id: item.id,
        message: item.payload.message,
        createdAt: item.createdAt,
        attachmentCount: item.payload.files?.length ?? 0,
        locked: item.delivery !== "queued",
        ...(item.payload.command?.name
            ? { commandName: item.payload.command.name }
            : {}),
    };
}
//# sourceMappingURL=promptQueue.js.map