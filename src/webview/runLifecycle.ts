import { parseRunEvent } from "../bridge/parsers";
import { parseV2Form, v2LegacyQuestions } from "../shared/opencodeV2Form";
import type {
	QuestionInfo,
	RunStreamEvent,
	TranscriptPart,
} from "../shared/protocol";

export const BLOCKER_POLL_INTERVAL_MS = 1_500;

export type NativeTurnTerminal = {
	outcome: "succeeded" | "failed" | "interrupted";
	error?: string;
};

export type PendingPermissionEvent = Extract<
	RunStreamEvent,
	{ type: "permission" }
>;
export type PendingQuestionEvent = Extract<
	RunStreamEvent,
	{ type: "question" }
>;

type ServeStreamPartKind = "text" | "reasoning";

export type ServeStreamState = {
	assistantMessageIds: Set<string>;
	lastAssistantMessageId: string | null;
	turnArmed: boolean;
	turnLive: boolean;
	partTextByKey: Map<string, string>;
	partKindByKey: Map<string, ServeStreamPartKind>;
	deltaSeenPartKeys: Set<string>;
	pendingDeltaByKey: Map<string, string>;
	pendingPermissionIds: Set<string>;
	pendingQuestionIds: Set<string>;
	pendingPermissions: Map<string, PendingPermissionEvent>;
	pendingQuestions: Map<string, PendingQuestionEvent>;
	visiblePermissionId?: string;
	visibleQuestionId?: string;
	sessionParents: Map<string, string | undefined>;
	blockerRevision: number;
	blockerPollHealthy: boolean;
	blockerPoll?: Promise<number>;
	baselineMessageIds?: Set<string>;
	v2LastUserMessageId: string | null;
	v2Tools: Map<
		string,
		{
			messageID: string;
			name: string;
			input: unknown;
			metadata?: Record<string, unknown>;
			status: string;
		}
	>;
};

type SessionTreeItem = {
	id: string;
	parentId?: string;
};

export type RunLifecycleAdapter = {
	isCurrentRun(requestId: string): boolean;
	emit(event: RunStreamEvent): void;
	onUserMessage?(message: { id: string; text?: string }): void;
	onAssistantMessage?(message: {
		id: string;
		parentId?: string;
	}): void;
	acceptBlockerSession(
		requestId: string,
		sessionId: string,
		blockerSessionId?: string,
		streamState?: ServeStreamState,
	): boolean;
	setPendingPermission(event: PendingPermissionEvent | undefined): void;
	setPendingQuestion(event: PendingQuestionEvent | undefined): void;
	requestServeJson<T>(pathname: string): Promise<T>;
};

export function createServeStreamState(): ServeStreamState {
	return {
		assistantMessageIds: new Set<string>(),
		lastAssistantMessageId: null,
		turnArmed: false,
		turnLive: false,
		partTextByKey: new Map<string, string>(),
		partKindByKey: new Map<string, ServeStreamPartKind>(),
		deltaSeenPartKeys: new Set<string>(),
		pendingDeltaByKey: new Map<string, string>(),
		pendingPermissionIds: new Set<string>(),
		pendingQuestionIds: new Set<string>(),
		pendingPermissions: new Map(),
		pendingQuestions: new Map(),
		sessionParents: new Map(),
		blockerRevision: 0,
		blockerPollHealthy: true,
		v2LastUserMessageId: null,
		v2Tools: new Map(),
	};
}

export function armServeStreamTurn(
	streamState: ServeStreamState,
	options?: { live?: boolean },
): void {
	streamState.turnArmed = true;
	if (options?.live) {
		streamState.turnLive = true;
	}
}

export function canCompleteServeStreamTurn(
	streamState: ServeStreamState,
): boolean {
	return (
		streamState.turnArmed &&
		streamState.turnLive &&
		streamState.blockerPollHealthy &&
		!hasPendingServeBlockers(streamState)
	);
}

export function isSessionIdleStatus(value: unknown, sessionId: string): boolean {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const status = (value as Record<string, unknown>)[sessionId];
	if (status === undefined) {
		return true;
	}
	return (
		typeof status === "object" &&
		status !== null &&
		(status as Record<string, unknown>).type === "idle"
	);
}

export function dispatchServeEvent(
	adapter: RunLifecycleAdapter,
	requestId: string,
	sessionId: string,
	event: unknown,
	streamState: ServeStreamState,
): { done: boolean; error?: string } {
	if (!adapter.isCurrentRun(requestId)) return { done: false };
	if (typeof event !== "object" || event === null) {
		return { done: false };
	}
	const record = event as { type?: unknown; properties?: unknown };
	const type = typeof record.type === "string" ? record.type : "";
	const properties =
		typeof record.properties === "object" && record.properties !== null
			? (record.properties as Record<string, unknown>)
			: {};
	if (type === "session.created") {
		const info = isRecord(properties.info) ? properties.info : properties;
		recordSessionParent(streamState, info.id ?? info.sessionID, info.parentID);
		return { done: false };
	}
	markServeTurnLive(type, properties, sessionId, streamState);

	if (type === "permission.asked") {
		const permissionEvent = normalizePermissionRequest(properties);
		if (
			permissionEvent &&
			acceptBlockerSession(
				adapter,
				requestId,
				sessionId,
				permissionEvent.sessionId,
				streamState,
			)
		) {
			surfacePendingPermission(
				adapter,
				permissionEvent,
				streamState,
			);
		}
		return { done: false };
	}

	if (type === "question.asked") {
		const questionEvent = normalizeQuestionRequest(properties);
		if (
			questionEvent &&
			acceptBlockerSession(
				adapter,
				requestId,
				sessionId,
				questionEvent.sessionId,
				streamState,
			)
		) {
			surfacePendingQuestion(adapter, questionEvent, streamState);
		}
		return { done: false };
	}

	if (type === "permission.replied") {
		if (
			acceptBlockerSession(
				adapter,
				requestId,
				sessionId,
				typeof properties.sessionID === "string"
					? properties.sessionID
					: undefined,
				streamState,
			) &&
			typeof properties.requestID === "string"
		) {
			settlePendingPermission(adapter, properties.requestID, streamState);
		}
		return { done: false };
	}

	if (type === "question.replied" || type === "question.rejected") {
		if (
			acceptBlockerSession(
				adapter,
				requestId,
				sessionId,
				typeof properties.sessionID === "string"
					? properties.sessionID
					: undefined,
				streamState,
			) &&
			typeof properties.requestID === "string"
		) {
			settlePendingQuestion(adapter, properties.requestID, streamState);
		}
		return { done: false };
	}

	if (type === "message.updated") {
		const info =
			typeof properties.info === "object" && properties.info !== null
				? (properties.info as Record<string, unknown>)
				: null;
		if (!info || info.sessionID !== sessionId) {
			return { done: false };
		}
		const messageId = typeof info.id === "string" ? info.id : null;
		if (info.role === "user") {
			if (messageId) {
				adapter.onUserMessage?.({ id: messageId });
			}
			return { done: false };
		}
		if (info.role !== "assistant") {
			return { done: false };
		}
		if (messageId) {
			streamState.assistantMessageIds.add(messageId);
			streamState.lastAssistantMessageId = messageId;
			adapter.onAssistantMessage?.({
				id: messageId,
				...(typeof info.parentID === "string"
					? { parentId: info.parentID }
					: {}),
			});
		}
		const usage = normalizeContextUsage(info);
		if (usage) {
			adapter.emit({ type: "context.usage", usage });
		}
		// OpenCode can publish a final-looking assistant message before its
		// session status reaches idle. Queue turns only advance on that status.
		return { done: false };
	}

	if (type === "session.error") {
		if (properties.sessionID === sessionId) {
			const message =
				extractEventErrorMessage(properties.error) ?? "运行失败。";
			adapter.emit({ type: "error", error: message });
			return { done: true, error: message };
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
		const part =
			typeof properties.part === "object" && properties.part !== null
				? properties.part
				: null;
		if (!part || (part as Record<string, unknown>).sessionID !== sessionId) {
			return { done: false };
		}
		const partRecord = part as Record<string, unknown>;
		const messageId =
			typeof partRecord.messageID === "string" ? partRecord.messageID : null;
		if (!isAssistantPartMessage(messageId, streamState)) {
			return { done: false };
		}
		const parsed = parseRunEvent({ part });
		if (parsed?.type === "part") {
			const incrementalPart = toIncrementalServePart(
				partRecord,
				parsed.part,
				streamState,
			);
			if (incrementalPart) {
				adapter.emit({ type: "part", part: incrementalPart });
			}
		}
		return { done: false };
	}

	if (type === "session.status") {
		const status =
			typeof properties.status === "object" && properties.status !== null
				? (properties.status as Record<string, unknown>)
				: null;
		if (
			properties.sessionID === sessionId &&
			status?.type === "idle" &&
			canCompleteServeStreamTurn(streamState)
		) {
			return { done: true };
		}
	}

	return { done: false };
}

export function dispatchV2ServeEvent(
	adapter: RunLifecycleAdapter,
	requestId: string,
	sessionId: string,
	event: unknown,
	streamState: ServeStreamState,
): { done: boolean; error?: string; stopped?: boolean } {
	if (!adapter.isCurrentRun(requestId)) return { done: false };
	if (!isRecord(event)) {
		return { done: false };
	}
	const type = typeof event.type === "string" ? event.type : "";
	const data = isRecord(event.data) ? event.data : {};
	if (type === "session.created") {
		recordSessionParent(streamState, data.sessionID, data.parentID);
		return { done: false };
	}
	const eventSessionID =
		typeof data.sessionID === "string" ? data.sessionID : undefined;
	const isBlockerLifecycleEvent =
		type === "permission.asked" ||
		type === "permission.replied" ||
		type === "form.created" ||
		type === "form.replied" ||
		type === "form.cancelled";
	if (
		eventSessionID &&
		eventSessionID !== sessionId &&
		!isBlockerLifecycleEvent
	) {
		return { done: false };
	}

	if (type === "session.inbox.delivered") {
		const messageID =
			typeof data.inboxID === "string" ? data.inboxID : undefined;
		if (messageID) {
			streamState.v2LastUserMessageId = messageID;
			adapter.onUserMessage?.({ id: messageID });
		}
		return { done: false };
	}

	if (type === "session.inbox.enqueued") {
		const messageID =
			typeof data.inboxID === "string" ? data.inboxID : undefined;
		const item = isRecord(data.item) ? data.item : undefined;
		const payload = isRecord(item?.payload) ? item.payload : undefined;
		const text =
			typeof payload?.text === "string" ? payload.text : undefined;
		if (messageID) {
			adapter.onUserMessage?.({
				id: messageID,
				...(text ? { text } : {}),
			});
		}
		return { done: false };
	}

	if (type === "session.execution.started") {
		streamState.turnLive = true;
		return { done: false };
	}

	if (type === "session.execution.succeeded") {
		streamState.turnLive = true;
		return { done: true };
	}

	if (type === "session.execution.interrupted") {
		const reason =
			typeof data.reason === "string" ? data.reason : "unknown";
		if (reason !== "user") {
			const message = `Session interrupted: ${reason}`;
			adapter.emit({ type: "error", error: message });
			return { done: true, error: message };
		}
		streamState.turnLive = true;
		return { done: true, stopped: true };
	}

	if (type === "session.execution.failed") {
		const message = sessionErrorMessage(data.error) ?? "运行失败。";
		adapter.emit({ type: "error", error: message });
		return { done: true, error: message };
	}

	if (type === "session.status" || type === "session.idle") {
		const status = isRecord(data.status) ? data.status : null;
		const statusType =
			type === "session.idle"
				? "idle"
				: typeof status?.type === "string"
					? status.type
					: "busy";
		if (statusType !== "idle") {
			streamState.turnLive = true;
		}
		return {
			done:
				statusType === "idle" &&
				canCompleteServeStreamTurn(streamState),
		};
	}

	if (type === "session.step.started") {
		const messageID =
			typeof data.assistantMessageID === "string"
				? data.assistantMessageID
				: undefined;
		if (messageID) {
			streamState.assistantMessageIds.add(messageID);
			streamState.lastAssistantMessageId = messageID;
			streamState.turnLive = true;
			adapter.onAssistantMessage?.({
				id: messageID,
				...(streamState.v2LastUserMessageId
					? { parentId: streamState.v2LastUserMessageId }
					: {}),
			});
		}
		return { done: false };
	}

	if (type === "session.step.ended" || type === "session.step.failed") {
		const usage = v2ContextUsage(data);
		if (usage) {
			adapter.emit({ type: "context.usage", usage });
		}
		// A step failure may be retried. session.execution.failed is the
		// terminal signal, so keep the run alive here.
		return { done: false };
	}

	if (
		type === "session.text.started" ||
		type === "session.reasoning.started"
	) {
		const kind = type.includes("reasoning") ? "reasoning" : "text";
		const key = v2ContentKey(data, kind);
		if (key) {
			// A retried step reuses the same assistant message and ordinal, so a
			// repeated start means the previous attempt's text must be replaced
			// instead of appended to.
			const restarted = streamState.partTextByKey.has(key);
			streamState.partKindByKey.set(key, kind);
			streamState.partTextByKey.set(key, "");
			streamState.deltaSeenPartKeys.delete(key);
			streamState.turnLive = true;
			if (restarted) {
				adapter.emit({
					type: "part",
					part:
						kind === "reasoning"
							? { type: "reasoning", text: "", streamKey: key, replace: true, raw: event }
							: { type: "text", text: "", streamKey: key, replace: true },
				});
			}
		}
		return { done: false };
	}

	if (
		type === "session.text.delta" ||
		type === "session.reasoning.delta"
	) {
		const kind = type.includes("reasoning") ? "reasoning" : "text";
		const key = v2ContentKey(data, kind);
		const delta =
			typeof data.delta === "string" ? data.delta : "";
		if (!key || delta.length === 0) {
			return { done: false };
		}
		streamState.partKindByKey.set(key, kind);
		streamState.partTextByKey.set(
			key,
			`${streamState.partTextByKey.get(key) ?? ""}${delta}`,
		);
		streamState.deltaSeenPartKeys.add(key);
		adapter.emit({
			type: "part",
			part:
				kind === "reasoning"
					? { type: "reasoning", text: delta, streamKey: key, raw: event }
					: { type: "text", text: delta, streamKey: key },
		});
		return { done: false };
	}

	if (
		type === "session.text.ended" ||
		type === "session.reasoning.ended"
	) {
		const kind = type.includes("reasoning") ? "reasoning" : "text";
		const key = v2ContentKey(data, kind);
		const text = typeof data.text === "string" ? data.text : "";
		if (!key || text.length === 0) {
			return { done: false };
		}
		const previous = streamState.partTextByKey.get(key) ?? "";
		if (streamState.deltaSeenPartKeys.has(key)) {
			if (text.startsWith(previous) && text.length > previous.length) {
				const delta = text.slice(previous.length);
				adapter.emit({
					type: "part",
					part:
						kind === "reasoning"
							? {
									type: "reasoning",
									text: delta,
									streamKey: key,
									raw: event,
								}
							: { type: "text", text: delta, streamKey: key },
				});
			} else if (text !== previous) {
				// The authoritative text is not an extension of what streamed
				// (lost deltas or a recovery rewrite), so replace it wholesale.
				adapter.emit({
					type: "part",
					part:
						kind === "reasoning"
							? {
									type: "reasoning",
									text,
									streamKey: key,
									replace: true,
									raw: event,
								}
							: { type: "text", text, streamKey: key, replace: true },
				});
			}
		} else {
			adapter.emit({
				type: "part",
				part:
					kind === "reasoning"
						? {
								type: "reasoning",
								text,
								streamKey: key,
								replace: true,
								raw: event,
							}
						: { type: "text", text, streamKey: key, replace: true },
			});
		}
		streamState.partTextByKey.set(key, text);
		return { done: false };
	}

	if (type.startsWith("session.tool.")) {
		const emitted = v2ToolEvent(data, type, event, streamState);
		if (emitted) {
			streamState.turnLive = true;
			adapter.emit(emitted);
		}
		return { done: false };
	}

	if (type === "permission.asked") {
		const permission = normalizePermissionRequest({
			...data,
			permission:
				typeof data.action === "string" ? data.action : "tool",
			patterns: data.resources,
		});
		if (
			permission &&
			acceptBlockerSession(
				adapter,
				requestId,
				sessionId,
				permission.sessionId,
				streamState,
			)
		) {
			surfacePendingPermission(adapter, permission, streamState);
			streamState.turnLive = true;
		}
		return { done: false };
	}

	if (type === "permission.replied") {
		if (
			acceptBlockerSession(
				adapter,
				requestId,
				sessionId,
				typeof data.sessionID === "string" ? data.sessionID : undefined,
				streamState,
			) &&
			typeof data.requestID === "string"
		) {
			settlePendingPermission(adapter, data.requestID, streamState);
		}
		return { done: false };
	}

	if (type === "form.created") {
		const question = v2FormQuestion(data.form);
		if (
			question &&
			acceptBlockerSession(
				adapter,
				requestId,
				sessionId,
				question.sessionId,
				streamState,
			)
		) {
			surfacePendingQuestion(adapter, question, streamState);
			streamState.turnLive = true;
		}
		return { done: false };
	}

	if (type === "form.replied" || type === "form.cancelled") {
		if (
			acceptBlockerSession(
				adapter,
				requestId,
				sessionId,
				typeof data.sessionID === "string" ? data.sessionID : undefined,
				streamState,
			) &&
			typeof data.id === "string"
		) {
			settlePendingQuestion(adapter, data.id, streamState);
		}
		return { done: false };
	}

	if (type === "session.retry.scheduled") {
		streamState.turnLive = true;
	}
	return { done: false };
}

function markServeTurnLive(
	type: string,
	properties: Record<string, unknown>,
	sessionId: string,
	streamState: ServeStreamState,
): void {
	if (properties.sessionID !== sessionId) {
		return;
	}

	if (type === "message.updated") {
		const info = isRecord(properties.info) ? properties.info : null;
		if (info?.role === "assistant") {
			streamState.turnLive = true;
		}
		return;
	}

	if (type === "message.part.delta" || type === "message.part.updated") {
		return;
	}

	if (type === "session.status") {
		const status = isRecord(properties.status) ? properties.status : null;
		if (status?.type !== "idle") {
			streamState.turnLive = true;
		}
		return;
	}

	streamState.turnLive = true;
}

function normalizeContextUsage(
	info: Record<string, unknown>,
): Extract<RunStreamEvent, { type: "context.usage" }>["usage"] | null {
	const metadata = isRecord(info.metadata) ? info.metadata : undefined;
	const assistant = isRecord(metadata?.assistant)
		? metadata.assistant
		: info;
	const tokens = isRecord(assistant.tokens) ? assistant.tokens : undefined;
	if (!tokens) {
		return null;
	}
	const cache = isRecord(tokens.cache) ? tokens.cache : undefined;
	const input = toNonNegativeFiniteNumber(tokens.input);
	const cacheRead = toNonNegativeFiniteNumber(cache?.read);
	if (input === undefined && cacheRead === undefined) {
		return null;
	}

	const providerId =
		typeof assistant.providerID === "string" ? assistant.providerID : undefined;
	const modelId =
		typeof assistant.modelID === "string" ? assistant.modelID : undefined;
	return {
		usedTokens: (input ?? 0) + (cacheRead ?? 0),
		...(providerId && modelId ? { model: `${providerId}/${modelId}` } : {}),
	};
}

function toNonNegativeFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: undefined;
}

export function pollServeBlockers(
	adapter: RunLifecycleAdapter,
	requestId: string,
	sessionId: string,
	streamState: ServeStreamState,
): Promise<number> {
	if (streamState.blockerPoll) return streamState.blockerPoll;
	const promise = pollServeBlockersInternal(adapter, requestId, sessionId, streamState)
		.finally(() => {
			if (streamState.blockerPoll === promise) streamState.blockerPoll = undefined;
		});
	streamState.blockerPoll = promise;
	return promise;
}

async function pollServeBlockersInternal(
	adapter: RunLifecycleAdapter,
	requestId: string,
	sessionId: string,
	streamState: ServeStreamState,
): Promise<number> {
	if (!adapter.isCurrentRun(requestId)) {
		return 0;
	}
	const revision = streamState.blockerRevision;
	streamState.blockerPollHealthy = false;

	const [permissionsResult, questionsResult] = await Promise.allSettled([
		adapter.requestServeJson<unknown[]>("/permission"),
		adapter.requestServeJson<unknown[]>("/question"),
	]);

	const permissionsOk = permissionsResult.status === "fulfilled" && Array.isArray(permissionsResult.value);
	const questionsOk = questionsResult.status === "fulfilled" && Array.isArray(questionsResult.value);
	const permissions =
		permissionsResult.status === "fulfilled"
			? normalizePermissionRequestList(permissionsResult.value)
			: [];
	const questions =
		questionsResult.status === "fulfilled"
			? normalizeQuestionRequestList(questionsResult.value)
			: [];

	let ancestryOk = true;
	if (permissions.length > 0 || questions.length > 0) {
		try {
			const sessions = normalizeSessionTree(
				await adapter.requestServeJson<unknown[]>("/session"),
			);
			for (const session of sessions) {
				recordSessionParent(streamState, session.id, session.parentId);
			}
		} catch {
			// A paginated or unavailable list is not evidence of ownership.
			// Resolve each unknown request through its native parent chain.
		}
		for (const event of [...permissions, ...questions]) {
			try {
				await resolveBlockerAncestry(adapter, sessionId, event.sessionId, streamState);
			} catch {
				ancestryOk = false;
			}
		}
	}

	if (!adapter.isCurrentRun(requestId) || revision !== streamState.blockerRevision) return 0;
	streamState.blockerPollHealthy = permissionsOk && questionsOk && ancestryOk;
	const belongs = (event: { sessionId: string }) =>
		acceptBlockerSession(adapter, requestId, sessionId, event.sessionId, streamState);
	let surfaced = 0;
	if (permissionsOk) {
		surfaced += reconcilePendingPermissions(adapter, permissions.filter(belongs), streamState);
	}
	if (questionsOk) {
		surfaced += reconcilePendingQuestions(adapter, questions.filter(belongs), streamState);
	}
	return surfaced;
}

function recordSessionParent(state: ServeStreamState, id: unknown, parent: unknown): void {
	if (typeof id === "string" && id !== "global") {
		state.sessionParents.set(id, typeof parent === "string" ? parent : undefined);
	}
}

export function isRunBlockerSession(
	sessionId: string,
	blockerSessionId: string | undefined,
	state: ServeStreamState,
): boolean {
	const visited = new Set<string>();
	let id = blockerSessionId;
	while (id && id !== "global" && !visited.has(id)) {
		if (id === sessionId) return true;
		visited.add(id);
		id = state.sessionParents.get(id);
	}
	return false;
}

function acceptBlockerSession(
	adapter: RunLifecycleAdapter,
	requestId: string,
	sessionId: string,
	blockerSessionId: string | undefined,
	state: ServeStreamState,
): boolean {
	return adapter.isCurrentRun(requestId) &&
		isRunBlockerSession(sessionId, blockerSessionId, state) &&
		adapter.acceptBlockerSession(requestId, sessionId, blockerSessionId, state);
}

async function resolveBlockerAncestry(
	adapter: RunLifecycleAdapter,
	root: string,
	blocker: string,
	state: ServeStreamState,
): Promise<void> {
	const visited = new Set<string>();
	let id: string | undefined = blocker;
	while (id && id !== root && id !== "global" && !visited.has(id)) {
		visited.add(id);
		if (!state.sessionParents.has(id)) {
			const info = await adapter.requestServeJson<unknown>(`/session/${encodeURIComponent(id)}`);
			if (!isRecord(info) || info.id !== id) throw new Error("Session ancestry unavailable.");
			recordSessionParent(state, info.id, info.parentID);
		}
		id = state.sessionParents.get(id);
	}
}

export function hasPendingServeBlockers(
	streamState: ServeStreamState,
): boolean {
	return (
		streamState.pendingPermissionIds.size > 0 ||
		streamState.pendingQuestionIds.size > 0
	);
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
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

function reconcilePendingPermissions(
	adapter: RunLifecycleAdapter,
	permissions: PendingPermissionEvent[],
	streamState: ServeStreamState,
): number {
	streamState.pendingPermissions = new Map(permissions.map((event) => [event.permissionId, event]));
	streamState.pendingPermissionIds = new Set(streamState.pendingPermissions.keys());
	return presentPendingPermission(adapter, streamState) ? 1 : 0;
}

function reconcilePendingQuestions(
	adapter: RunLifecycleAdapter,
	questions: PendingQuestionEvent[],
	streamState: ServeStreamState,
): number {
	streamState.pendingQuestions = new Map(questions.map((event) => [event.questionId, event]));
	streamState.pendingQuestionIds = new Set(streamState.pendingQuestions.keys());
	return presentPendingQuestion(adapter, streamState) ? 1 : 0;
}

function surfacePendingPermission(
	adapter: RunLifecycleAdapter,
	event: PendingPermissionEvent,
	streamState: ServeStreamState,
): boolean {
	if (streamState.pendingPermissionIds.has(event.permissionId)) return false;
	streamState.pendingPermissionIds.add(event.permissionId);
	streamState.pendingPermissions.set(event.permissionId, event);
	streamState.blockerRevision += 1;
	return presentPendingPermission(adapter, streamState);
}

function surfacePendingQuestion(
	adapter: RunLifecycleAdapter,
	event: PendingQuestionEvent,
	streamState: ServeStreamState,
): boolean {
	if (streamState.pendingQuestionIds.has(event.questionId)) return false;
	streamState.pendingQuestionIds.add(event.questionId);
	streamState.pendingQuestions.set(event.questionId, event);
	streamState.blockerRevision += 1;
	return presentPendingQuestion(adapter, streamState);
}

function presentPendingPermission(adapter: RunLifecycleAdapter, state: ServeStreamState): boolean {
	const event = (state.visiblePermissionId && state.pendingPermissions.get(state.visiblePermissionId)) ||
		state.pendingPermissions.values().next().value;
	if (event?.permissionId === state.visiblePermissionId) return false;
	state.visiblePermissionId = event?.permissionId;
	adapter.setPendingPermission(event);
	if (event) adapter.emit(event);
	return event !== undefined;
}

function presentPendingQuestion(adapter: RunLifecycleAdapter, state: ServeStreamState): boolean {
	const event = (state.visibleQuestionId && state.pendingQuestions.get(state.visibleQuestionId)) ||
		state.pendingQuestions.values().next().value;
	if (event?.questionId === state.visibleQuestionId) return false;
	state.visibleQuestionId = event?.questionId;
	adapter.setPendingQuestion(event);
	if (event) adapter.emit(event);
	return event !== undefined;
}

function settlePendingPermission(adapter: RunLifecycleAdapter, id: string, state: ServeStreamState): void {
	state.blockerRevision += 1;
	state.pendingPermissionIds.delete(id);
	state.pendingPermissions.delete(id);
	presentPendingPermission(adapter, state);
}

function settlePendingQuestion(adapter: RunLifecycleAdapter, id: string, state: ServeStreamState): void {
	state.blockerRevision += 1;
	state.pendingQuestionIds.delete(id);
	state.pendingQuestions.delete(id);
	presentPendingQuestion(adapter, state);
}

export function settleServeBlocker(
	adapter: RunLifecycleAdapter, kind: "permission" | "question", id: string, state: ServeStreamState,
): void {
	if (kind === "permission") settlePendingPermission(adapter, id, state);
	else settlePendingQuestion(adapter, id, state);
}

function v2ContentKey(
	data: Record<string, unknown>,
	kind: ServeStreamPartKind,
): string | null {
	const messageID =
		typeof data.assistantMessageID === "string"
			? data.assistantMessageID
			: null;
	const ordinal =
		typeof data.ordinal === "number" && Number.isFinite(data.ordinal)
			? data.ordinal
			: null;
	return messageID && ordinal !== null
		? `${messageID}:${kind}:${String(ordinal)}`
		: null;
}

function v2ContextUsage(
	data: Record<string, unknown>,
): Extract<RunStreamEvent, { type: "context.usage" }>["usage"] | null {
	const tokens = isRecord(data.tokens) ? data.tokens : undefined;
	if (!tokens) {
		return null;
	}
	const cache = isRecord(tokens.cache) ? tokens.cache : undefined;
	const input =
		typeof tokens.input === "number" && Number.isFinite(tokens.input)
			? tokens.input
			: 0;
	const cacheRead =
		typeof cache?.read === "number" && Number.isFinite(cache.read)
			? cache.read
			: 0;
	const model = isRecord(data.model) ? data.model : undefined;
	const providerID =
		typeof model?.providerID === "string" ? model.providerID : undefined;
	const modelID = typeof model?.id === "string" ? model.id : undefined;
	return {
		usedTokens: input + cacheRead,
		...(providerID && modelID ? { model: `${providerID}/${modelID}` } : {}),
	};
}

function sessionErrorMessage(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}
	if (!isRecord(value)) {
		return null;
	}
	const message =
		typeof value.message === "string"
			? value.message
			: typeof value.type === "string"
				? value.type
				: undefined;
	return message?.trim() || null;
}

export function recoverV2TurnTerminal(
	value: unknown,
	baseline: ReadonlySet<string> | undefined,
): NativeTurnTerminal | undefined {
	if (!baseline || !Array.isArray(value)) return undefined;
	let currentTurn = false;
	let terminal: NativeTurnTerminal | undefined;
	for (const message of value) {
		if (!isRecord(message) || !isRecord(message.info)) continue;
		const info = message.info;
		if (typeof info.id !== "string" || baseline.has(info.id)) continue;
		if (info.role === "user") {
			currentTurn = true;
			terminal = undefined;
		}
		if (currentTurn && info.type === "idle" &&
			(info.outcome === "succeeded" || info.outcome === "failed" || info.outcome === "interrupted")) {
			const error = sessionErrorMessage(info.error);
			terminal = { outcome: info.outcome, ...(error ? { error } : {}) };
		}
	}
	return terminal;
}

function v2ToolEvent(
	data: Record<string, unknown>,
	type: string,
	event: Record<string, unknown>,
	streamState: ServeStreamState,
): Extract<RunStreamEvent, { type: "part" }> | null {
	const messageID =
		typeof data.assistantMessageID === "string"
			? data.assistantMessageID
			: null;
	const toolID = typeof data.id === "string" ? data.id : null;
	if (!messageID || !toolID) {
		return null;
	}

	const previous = streamState.v2Tools.get(toolID);
	let name =
		typeof data.name === "string" && data.name.trim()
			? data.name.trim()
			: previous?.name ?? "tool";
	let input = previous?.input ?? {};
	let metadata = previous?.metadata;
	let status = previous?.status ?? "pending";

	if (type === "session.tool.input.started" && typeof data.name === "string") {
		name = data.name;
	} else if (type === "session.tool.input.delta") {
		const raw =
			typeof data.delta === "string"
				? `${typeof input === "string" ? input : ""}${data.delta}`
				: input;
		input = raw;
		status = "pending";
	} else if (type === "session.tool.input.ended") {
		input = typeof data.text === "string" ? data.text : input;
		status = "pending";
	} else if (type === "session.tool.called") {
		input = data.input ?? input;
		status = data.executed === false ? "pending" : "running";
	} else if (type === "session.tool.progress") {
		metadata = isRecord(data.metadata) ? data.metadata : metadata;
		status = "running";
	} else if (type === "session.tool.success") {
		input = data.input ?? input;
		metadata = isRecord(data.metadata) ? data.metadata : metadata;
		status = "completed";
	} else if (type === "session.tool.failed") {
		input = data.input ?? input;
		metadata = isRecord(data.metadata) ? data.metadata : metadata;
		status = "error";
	}

	streamState.v2Tools.set(toolID, {
		messageID,
		name,
		input,
		metadata,
		status,
	});

	const raw = {
		id: toolID,
		callID: toolID,
		type: "tool",
		sessionID: data.sessionID,
		messageID,
		tool: name,
		name,
		executed: data.executed,
		state: {
			status,
			input,
			...(metadata ? { metadata } : {}),
			...(type === "session.tool.success"
				? { output: v2ContentText(data.content) }
				: {}),
			...(type === "session.tool.failed"
				? {
						error:
							sessionErrorMessage(data.error) ??
							"Tool execution failed.",
					}
				: {}),
		},
		time: {
			created:
				typeof previous === "undefined" &&
				typeof event.created === "number"
					? event.created
					: undefined,
		},
	};
	return {
		type: "part",
		part: {
			type: "tool",
			toolName: name,
			status,
			raw,
		},
	};
}

function v2ContentText(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value;
	}
	if (!Array.isArray(value)) {
		return undefined;
	}
	const text = value
		.flatMap((part) =>
			isRecord(part) && typeof part.text === "string" ? [part.text] : [],
		)
		.join("\n");
	return text || undefined;
}

function v2FormQuestion(value: unknown): PendingQuestionEvent | null {
	const form = parseV2Form(value);
	return form ? {
		type: "question", questionId: form.id, sessionId: form.sessionID,
		questions: v2LegacyQuestions(form), form,
	} : null;
}

function normalizeQuestionInfoList(value: unknown): QuestionInfo[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item): QuestionInfo[] => {
		if (typeof item !== "object" || item === null) {
			return [];
		}

		const record = item as Record<string, unknown>;
		if (
			typeof record.header !== "string" ||
			typeof record.question !== "string" ||
			!Array.isArray(record.options)
		) {
			return [];
		}

		const options = record.options.flatMap(
			(option): QuestionInfo["options"] => {
				if (typeof option !== "object" || option === null) {
					return [];
				}
				const optionRecord = option as Record<string, unknown>;
				if (
					typeof optionRecord.label !== "string" ||
					typeof optionRecord.description !== "string"
				) {
					return [];
				}
				return [
					{
						label: optionRecord.label,
						description: optionRecord.description,
					},
				];
			},
		);

		return [
			{
				header: record.header,
				question: record.question,
				options,
				multiple:
					typeof record.multiple === "boolean" ? record.multiple : undefined,
				custom: typeof record.custom === "boolean" ? record.custom : undefined,
			},
		];
	});
}

function normalizePermissionRequestList(
	value: unknown,
): PendingPermissionEvent[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((item) => {
		const event = normalizePermissionRequest(item);
		return event ? [event] : [];
	});
}

function normalizePermissionRequest(
	value: unknown,
): PendingPermissionEvent | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}

	const record = value as Record<string, unknown>;
	if (typeof record.id !== "string" || typeof record.sessionID !== "string") {
		return null;
	}

	return {
		type: "permission",
		permissionId: record.id,
		sessionId: record.sessionID,
		toolName:
			typeof record.permission === "string" ? record.permission : "tool",
		patterns: Array.isArray(record.patterns)
			? record.patterns.filter(
					(item): item is string => typeof item === "string",
				)
			: [],
		message: getPermissionRequestMessage(record),
	};
}

function getPermissionRequestMessage(
	record: Record<string, unknown>,
): string | undefined {
	if (typeof record.message === "string") {
		return record.message;
	}
	const metadata =
		typeof record.metadata === "object" && record.metadata !== null
			? (record.metadata as Record<string, unknown>)
			: null;
	if (typeof metadata?.description === "string") {
		return metadata.description;
	}
	if (typeof metadata?.filepath === "string") {
		return metadata.filepath;
	}
	return undefined;
}

function normalizeQuestionRequestList(value: unknown): PendingQuestionEvent[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((item) => {
		const event = normalizeQuestionRequest(item);
		return event ? [event] : [];
	});
}

function normalizeQuestionRequest(value: unknown): PendingQuestionEvent | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}

	const record = value as Record<string, unknown>;
	if (record.form !== undefined) return v2FormQuestion(record.form);
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

function normalizeSessionTree(value: unknown): SessionTreeItem[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item): SessionTreeItem[] => {
		if (typeof item !== "object" || item === null) {
			return [];
		}
		const record = item as Record<string, unknown>;
		if (typeof record.id !== "string") {
			return [];
		}
		return [
			{
				id: record.id,
				parentId:
					typeof record.parentID === "string" ? record.parentID : undefined,
			},
		];
	});
}

function createAbortError(): Error {
	const error = new Error("Aborted");
	error.name = "AbortError";
	return error;
}

function toTokenDeltaServePart(
	properties: Record<string, unknown>,
	sessionId: string,
	streamState: ServeStreamState,
): TranscriptPart | null {
	if (
		properties.sessionID !== sessionId ||
		properties.field !== "text" ||
		typeof properties.delta !== "string" ||
		properties.delta.length === 0
	) {
		return null;
	}

	const messageId =
		typeof properties.messageID === "string" ? properties.messageID : null;
	const partId =
		typeof properties.partID === "string" ? properties.partID : null;
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
		streamState.pendingDeltaByKey.set(
			partKey,
			`${previous}${properties.delta}`,
		);
		return null;
	}

	streamState.deltaSeenPartKeys.add(partKey);
	streamState.partTextByKey.set(
		partKey,
		`${streamState.partTextByKey.get(partKey) ?? ""}${properties.delta}`,
	);

	if (kind === "text") {
		return {
			type: "text",
			text: properties.delta,
			streamKey: partKey,
		};
	}

	return {
		type: "reasoning",
		text: properties.delta,
		streamKey: partKey,
	};
}

function isAssistantPartMessage(
	messageId: string | null,
	streamState: ServeStreamState,
): boolean {
	if (!messageId) {
		return streamState.lastAssistantMessageId !== null;
	}
	return (
		streamState.assistantMessageIds.has(messageId) ||
		streamState.lastAssistantMessageId === messageId
	);
}

function toIncrementalServePart(
	partRecord: Record<string, unknown>,
	parsedPart: TranscriptPart,
	streamState: ServeStreamState,
): TranscriptPart | null {
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
					streamKey: partKey,
				};
			}
			return {
				type: "reasoning",
				text: pendingDelta,
				streamKey: partKey,
				raw: parsedPart.raw,
			};
		}
	}

	const previousText = streamState.partTextByKey.get(partKey) ?? "";
	const currentText = parsedPart.text;
	streamState.partTextByKey.set(partKey, currentText);

	if (streamState.deltaSeenPartKeys.has(partKey)) {
		if (
			currentText.length < previousText.length ||
			!currentText.startsWith(previousText)
		) {
			streamState.deltaSeenPartKeys.delete(partKey);
		} else {
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
			streamKey: partKey,
		};
	}

	return {
		type: "reasoning",
		text: nextText,
		streamKey: partKey,
		raw: parsedPart.raw,
	};
}

function getServePartKey(partRecord: Record<string, unknown>): string {
	const messageId =
		typeof partRecord.messageID === "string" ? partRecord.messageID : "message";
	const partId = typeof partRecord.id === "string" ? partRecord.id : undefined;
	if (partId) {
		return `${messageId}:${partId}`;
	}
	const type = typeof partRecord.type === "string" ? partRecord.type : "part";
	return `${messageId}:${type}`;
}

function extractEventErrorMessage(
	value: unknown,
	visited = new Set<object>(),
): string | null {
	if (typeof value === "string") {
		return stripAnsi(value).trim() || null;
	}

	if (!isRecord(value)) {
		return null;
	}
	if (visited.has(value)) {
		return null;
	}
	visited.add(value);

	const direct = [value.message, value.text]
		.map((entry) => (typeof entry === "string" ? stripAnsi(entry).trim() : ""))
		.find((entry) => entry.length > 0);
	if (direct) {
		return direct;
	}

	for (const nested of [value.data, value.error, value.cause]) {
		const message = extractEventErrorMessage(nested, visited);
		if (message) {
			return message;
		}
	}

	const errorName = [value.name, value._tag]
		.map((entry) => (typeof entry === "string" ? stripAnsi(entry).trim() : ""))
		.find((entry) => entry.length > 0);
	if (errorName === "ProviderModelNotFoundError") {
		const providerId = typeof value.providerID === "string" ? value.providerID : "";
		const modelId = typeof value.modelID === "string" ? value.modelID : "";
		if (providerId && modelId) {
			return `Model not found: ${providerId}/${modelId}.`;
		}
	}

	return errorName || null;
}

function stripAnsi(value: string): string {
	return value.replace(
		new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"),
		"",
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
