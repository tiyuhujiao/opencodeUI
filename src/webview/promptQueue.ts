import { randomBytes } from "node:crypto";
import type {
	QueuedPromptSummary,
	RunPromptPayload,
	RunQueueState,
} from "../shared/protocol";

export const MAX_PROMPT_QUEUE_ITEMS = 100;

const OPENCODE_ID_RANDOM_ALPHABET =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const OPENCODE_ID_RANDOM_LENGTH = 14;
let lastMessageIdTimestamp = 0;
let messageIdCounter = 0;

export type QueuedPromptDelivery = "queued" | "submitting" | "submitted";

export type QueuedPromptEntry = {
	id: string;
	createdAt: number;
	payload: RunPromptPayload;
	delivery: QueuedPromptDelivery;
	messageId: string;
};

export function createQueuedPrompt(
	id: string,
	createdAt: number,
	payload: RunPromptPayload,
): QueuedPromptEntry {
	return {
		id,
		createdAt,
		payload: cloneRunPromptPayload(payload),
		delivery: "queued",
		messageId: createOpencodeMessageId(createdAt),
	};
}

export function createOpencodeMessageId(timestamp = Date.now()): string {
	if (timestamp !== lastMessageIdTimestamp) {
		lastMessageIdTimestamp = timestamp;
		messageIdCounter = 0;
	}
	messageIdCounter += 1;

	const encodedTime = BigInt(timestamp) * 0x1000n + BigInt(messageIdCounter);
	const timeHex = encodedTime.toString(16).padStart(12, "0").slice(-12);
	const random = randomBytes(OPENCODE_ID_RANDOM_LENGTH);
	let suffix = "";
	for (const value of random) {
		suffix += OPENCODE_ID_RANDOM_ALPHABET[value % OPENCODE_ID_RANDOM_ALPHABET.length];
	}
	return `msg_${timeHex}${suffix}`;
}

export function toRunQueueState(
	queue: readonly QueuedPromptEntry[],
): RunQueueState {
	return {
		items: queue.map(toSummary),
	};
}

export function updateQueuedPromptMessage(
	queue: readonly QueuedPromptEntry[],
	id: string,
	message: string,
): QueuedPromptEntry[] | null {
	const trimmed = message.trim();
	const index = queue.findIndex((item) => item.id === id);
	if (index < 0 || !trimmed) {
		return null;
	}

	return queue.map((item, itemIndex) =>
		itemIndex === index
			? {
					...item,
					payload: {
						...cloneRunPromptPayload(item.payload),
						message: trimmed,
					},
				}
			: cloneQueuedPrompt(item),
	);
}

export function removeQueuedPrompt(
	queue: readonly QueuedPromptEntry[],
	id: string,
): { queue: QueuedPromptEntry[]; removed: QueuedPromptEntry } | null {
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

export function cloneRunPromptPayload(
	payload: RunPromptPayload,
): RunPromptPayload {
	return {
		...payload,
		...(payload.files ? { files: [...payload.files] } : {}),
		...(payload.command ? { command: { ...payload.command } } : {}),
	};
}

function cloneQueuedPrompt(item: QueuedPromptEntry): QueuedPromptEntry {
	return {
		...item,
		payload: cloneRunPromptPayload(item.payload),
	};
}

function toSummary(item: QueuedPromptEntry): QueuedPromptSummary {
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
