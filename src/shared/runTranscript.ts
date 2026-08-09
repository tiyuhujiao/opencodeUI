import type {
	ContextUsage,
	RunStreamEvent,
	TranscriptMessage,
	TranscriptPartReasoning,
	TranscriptPartText,
	TranscriptPartTool,
} from "./protocol";

const RUN_ERROR_PREFIX = "运行错误：";

export function preserveContextUsage(
	previous: ContextUsage | undefined,
	incoming: ContextUsage,
): ContextUsage {
	if (incoming.usedTokens === 0 && previous && previous.usedTokens > 0) {
		return {
			...previous,
			...(incoming.model ? { model: incoming.model } : {}),
		};
	}
	return incoming;
}

export function applyRunEventToTranscript(
	messages: TranscriptMessage[],
	event: RunStreamEvent,
	assistantIndex: number,
): TranscriptMessage[] {
	const target = messages[assistantIndex];
	if (!target) {
		return messages;
	}

	const next = [...messages];
	const nextTarget: TranscriptMessage = {
		...target,
		parts: [...target.parts],
	};
	next[assistantIndex] = nextTarget;

	if (event.type === "context.usage") {
		const previousUsage = findLatestContextUsage(messages, assistantIndex);
		nextTarget.contextUsage = preserveContextUsage(previousUsage, event.usage);
		return next;
	}

	if (event.type === "part") {
		if (event.part.type === "tool" && isStepBoundaryPart(event.part)) {
			return messages;
		}

		if (event.part.type === "text") {
			const existingIndex = findStreamPartAppendIndex(
				nextTarget.parts,
				event.part,
			);
			const previous = nextTarget.parts[existingIndex];
			if (existingIndex >= 0 && previous?.type === "text") {
				nextTarget.parts[existingIndex] = {
					...previous,
					...event.part,
					text: `${previous.text}${event.part.text}`,
				};
			} else {
				nextTarget.parts.push(event.part);
			}
			return next;
		}

		if (event.part.type === "reasoning") {
			const existingIndex = findStreamPartAppendIndex(
				nextTarget.parts,
				event.part,
			);
			const previous = nextTarget.parts[existingIndex];
			if (existingIndex >= 0 && previous?.type === "reasoning") {
				nextTarget.parts[existingIndex] = {
					...previous,
					...event.part,
					text: `${previous.text}${event.part.text}`,
					raw: event.part.raw ?? previous.raw,
				};
			} else {
				nextTarget.parts.push(event.part);
			}
			return next;
		}

		if (event.part.type === "tool") {
			const incomingKey = getToolPartUpdateKey(event.part);
			if (incomingKey) {
				const existingIndex = nextTarget.parts.findIndex(
					(part) =>
						part.type === "tool" &&
						getToolPartUpdateKey(part) === incomingKey,
				);
				if (existingIndex >= 0) {
					nextTarget.parts[existingIndex] = mergeToolPart(
						nextTarget.parts[existingIndex] as TranscriptPartTool,
						event.part,
					);
					return next;
				}
			}
		}

		nextTarget.parts.push(event.part);
		return next;
	}

	if (event.type === "error") {
		const errorPart: TranscriptPartText = {
			type: "text",
			text: `\n\n${RUN_ERROR_PREFIX}${event.error}`,
		};
		if (
			!nextTarget.parts.some(
				(part) =>
					part.type === "text" &&
					part.text.trimStart().startsWith(RUN_ERROR_PREFIX) &&
					part.text === errorPart.text,
			)
		) {
			nextTarget.parts.push(errorPart);
		}
	}

	return next;
}

function findStreamPartAppendIndex(
	parts: TranscriptMessage["parts"],
	incoming: TranscriptPartText | TranscriptPartReasoning,
): number {
	if (incoming.streamKey) {
		for (let index = parts.length - 1; index >= 0; index -= 1) {
			const candidate = parts[index];
			if (
				candidate?.type === incoming.type &&
				candidate.streamKey === incoming.streamKey
			) {
				return index;
			}
		}
		return -1;
	}

	const lastIndex = parts.length - 1;
	const previous = parts[lastIndex];
	return previous?.type === incoming.type && !previous.streamKey ? lastIndex : -1;
}

function isStepBoundaryPart(part: TranscriptPartTool): boolean {
	const raw = toRecord(part.raw);
	const nestedPart = toRecord(raw?.part);
	const rawType = typeof raw?.type === "string" ? raw.type : null;
	const partType = typeof nestedPart?.type === "string" ? nestedPart.type : null;
	return (
		rawType === "step_start" ||
		rawType === "step_finish" ||
		partType === "step-start" ||
		partType === "step-finish"
	);
}

function findLatestContextUsage(
	messages: TranscriptMessage[],
	beforeIndex: number,
): ContextUsage | undefined {
	for (let index = beforeIndex; index >= 0; index -= 1) {
		const usage = messages[index]?.contextUsage;
		if (usage) {
			return usage;
		}
	}
	return undefined;
}

function mergeToolPart(
	previous: TranscriptPartTool,
	next: TranscriptPartTool,
): TranscriptPartTool {
	return {
		type: "tool",
		toolName: next.toolName || previous.toolName,
		status: next.status || previous.status,
		raw: next.raw ?? previous.raw,
	};
}

function getToolPartUpdateKey(part: TranscriptPartTool): string | null {
	const toolName = part.toolName.trim().toLowerCase();
	const raw = toRecord(part.raw);
	const nestedPart = toRecord(raw?.part);
	const state = toRecord(nestedPart?.state) ?? toRecord(raw?.state);
	const input = toRecord(state?.input);
	const id = pickFirstString([
		nestedPart?.id,
		nestedPart?.partID,
		nestedPart?.partId,
		nestedPart?.toolCallID,
		nestedPart?.toolCallId,
		raw?.id,
		raw?.partID,
		raw?.partId,
		raw?.toolCallID,
		raw?.toolCallId,
		state?.id,
		state?.partID,
		state?.partId,
		state?.toolCallID,
		state?.toolCallId,
	]);
	if (id) {
		return `${toolName}:id:${id}`;
	}

	if (toolName !== "task") {
		return null;
	}

	const semantic = pickFirstString([input?.description, input?.prompt]);
	return semantic
		? `${toolName}:semantic:${semantic.toLowerCase().replace(/\s+/g, " ")}`
		: null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

function pickFirstString(values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value !== "string") {
			continue;
		}
		const trimmed = value.trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
	}
	return null;
}
