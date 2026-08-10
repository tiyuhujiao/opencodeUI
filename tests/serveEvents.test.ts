import { describe, expect, it, vi } from "vitest";
import {
	armServeStreamTurn,
	createServeStreamState,
	dispatchServeEvent,
	pollServeBlockers,
	type RunLifecycleAdapter,
	type ServeStreamState,
} from "../src/webview/runLifecycle";

function createLifecycle(
	options: {
		posted?: unknown[];
		currentRequestId?: string;
		requestServeJson?: (pathname: string) => Promise<unknown>;
	} = {},
): RunLifecycleAdapter {
	const posted = options.posted ?? [];
	const currentRequestId = options.currentRequestId;
	return {
		isCurrentRun: (requestId) =>
			currentRequestId === undefined || currentRequestId === requestId,
		emit: (event) => {
			posted.push({
				type: "run.event",
				requestId: currentRequestId ?? "request-1",
				ok: true,
				payload: { event },
			});
		},
		acceptBlockerSession: (requestId, sessionId, blockerSessionId) =>
			Boolean(
				blockerSessionId &&
					(blockerSessionId === sessionId || currentRequestId === requestId),
			),
		setPendingPermission: () => {},
		setPendingQuestion: () => {},
		requestServeJson: async (pathname) =>
			options.requestServeJson?.(pathname) as never,
	};
}

describe("run lifecycle serve event dispatch", () => {
	it("优先展示 session.error 的嵌套真实消息，而不是 UnknownError 名称", () => {
		const posted: unknown[] = [];
		const lifecycle = createLifecycle({ posted });
		const streamState = createServeStreamState();

		const result = dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "session.error",
				properties: {
					sessionID: "session-1",
					error: {
						name: "UnknownError",
						data: {
							message: "Model not found: cpa111/gpt-5.6-sol.",
						},
					},
				},
			},
			streamState,
		);

		expect(result).toEqual({
			done: true,
			error: "Model not found: cpa111/gpt-5.6-sol.",
		});
		expect(posted).toContainEqual(
			expect.objectContaining({
				payload: {
					event: {
						type: "error",
						error: "Model not found: cpa111/gpt-5.6-sol.",
					},
				},
			}),
		);
	});

	it("只在 prompt 已提交、当前 turn 已活动且 session 真正 idle 后完成", () => {
		const lifecycle = createLifecycle();
		const streamState = createServeStreamState();
		const idleEvent = {
			type: "session.status",
			properties: {
				sessionID: "session-1",
				status: { type: "idle" },
			},
		};

		expect(
			dispatchServeEvent(
				lifecycle,
				"request-1",
				"session-1",
				idleEvent,
				streamState,
			),
		).toEqual({ done: false });

		armServeStreamTurn(streamState);
		expect(
			dispatchServeEvent(
				lifecycle,
				"request-1",
				"session-1",
				idleEvent,
				streamState,
			),
		).toEqual({ done: false });

		expect(
			dispatchServeEvent(
				lifecycle,
				"request-1",
				"session-1",
				{
					type: "message.updated",
					properties: {
						sessionID: "session-1",
						info: {
							id: "assistant-1",
							sessionID: "session-1",
							role: "assistant",
							finish: "stop",
						},
					},
				},
				streamState,
			),
		).toEqual({ done: false });

		expect(
			dispatchServeEvent(
				lifecycle,
				"request-1",
				"session-1",
				idleEvent,
				streamState,
			),
		).toEqual({ done: true });
	});

	it("reports user and assistant message boundaries used by running Queue delivery", () => {
		const onUserMessage = vi.fn();
		const onAssistantMessage = vi.fn();
		const lifecycle: RunLifecycleAdapter = {
			...createLifecycle(),
			onUserMessage,
			onAssistantMessage,
		};
		const streamState = createServeStreamState();

		dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.updated",
				properties: {
					info: { id: "msg-user-2", sessionID: "session-1", role: "user" },
				},
			},
			streamState,
		);
		dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.updated",
				properties: {
					info: {
						id: "msg-assistant-2",
						parentID: "msg-user-2",
						sessionID: "session-1",
						role: "assistant",
					},
				},
			},
			streamState,
		);

		expect(onUserMessage).toHaveBeenCalledWith({ id: "msg-user-2" });
		expect(onAssistantMessage).toHaveBeenCalledWith({
			id: "msg-assistant-2",
			parentId: "msg-user-2",
		});
	});

	it("只转发当前 session 的权限请求，并过滤非字符串 pattern", () => {
		const posted: unknown[] = [];
		const lifecycle = createLifecycle({ posted });
		const streamState = createServeStreamState();

		const result = dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "permission.asked",
				properties: {
					sessionID: "session-1",
					id: "permission-1",
					permission: "bash",
					patterns: ["npm test", 42, "npm run build"],
					message: "需要执行命令",
				},
			},
			streamState,
		);

		expect(result).toEqual({ done: false });
		expect(posted).toHaveLength(1);
		expect(posted[0]).toMatchObject({
			type: "run.event",
			requestId: "request-1",
			ok: true,
			payload: {
				event: {
					type: "permission",
					permissionId: "permission-1",
					sessionId: "session-1",
					toolName: "bash",
					patterns: ["npm test", "npm run build"],
					message: "需要执行命令",
				},
			},
		});
	});

	it("转发 question.asked 为可交互问题并阻止 idle 提前完成", () => {
		const posted: unknown[] = [];
		const lifecycle = createLifecycle({ posted });
		const streamState = createServeStreamState();
		streamState.lastAssistantMessageId = "message-1";
		armServeStreamTurn(streamState);

		const questionResult = dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "question.asked",
				properties: {
					sessionID: "session-1",
					id: "question-1",
					questions: [
						{
							header: "File",
							question: "Which file should be edited?",
							options: [
								{ label: "README", description: "Use README.md" },
								{
									label: "New file",
									description: "Create a new markdown file",
								},
							],
							multiple: false,
							custom: true,
						},
					],
				},
			},
			streamState,
		);

		expect(questionResult).toEqual({ done: false });
		expect(posted[0]).toMatchObject({
			type: "run.event",
			requestId: "request-1",
			ok: true,
			payload: {
				event: {
					type: "question",
					questionId: "question-1",
					sessionId: "session-1",
					questions: [
						{
							header: "File",
							question: "Which file should be edited?",
							options: [
								{ label: "README", description: "Use README.md" },
								{
									label: "New file",
									description: "Create a new markdown file",
								},
							],
							multiple: false,
							custom: true,
						},
					],
				},
			},
		});
		expect(streamState.pendingQuestionIds.has("question-1")).toBe(true);

		const idleResult = dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "session.status",
				properties: {
					sessionID: "session-1",
					status: { type: "idle" },
				},
			},
			streamState,
		);

		expect(idleResult).toEqual({ done: false });

		dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "question.replied",
				properties: {
					sessionID: "session-1",
					requestID: "question-1",
				},
			},
			streamState,
		);

		const doneResult = dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "session.status",
				properties: {
					sessionID: "session-1",
					status: { type: "idle" },
				},
			},
			streamState,
		);

		expect(doneResult).toEqual({ done: true });
	});

	it("surfaces child session questions during the active parent run", () => {
		const posted: unknown[] = [];
		const lifecycle = createLifecycle({
			posted,
			currentRequestId: "request-1",
		});
		const streamState = createServeStreamState();
		streamState.lastAssistantMessageId = "message-1";
		armServeStreamTurn(streamState);
		dispatchServeEvent(
			lifecycle,
			"request-1",
			"parent-session",
			{
				type: "session.status",
				properties: {
					sessionID: "parent-session",
					status: { type: "busy" },
				},
			},
			streamState,
		);

		const questionResult = dispatchServeEvent(
			lifecycle,
			"request-1",
			"parent-session",
			{
				type: "question.asked",
				properties: {
					sessionID: "child-session",
					id: "question-child",
					questions: [
						{
							header: "File",
							question: "Which file should be edited?",
							options: [{ label: "README", description: "Use README.md" }],
						},
					],
				},
			},
			streamState,
		);

		expect(questionResult).toEqual({ done: false });
		expect(posted[0]).toMatchObject({
			type: "run.event",
			requestId: "request-1",
			ok: true,
			payload: {
				event: {
					type: "question",
					questionId: "question-child",
					sessionId: "child-session",
				},
			},
		});
		expect(streamState.pendingQuestionIds.has("question-child")).toBe(true);

		const idleResult = dispatchServeEvent(
			lifecycle,
			"request-1",
			"parent-session",
			{
				type: "session.status",
				properties: {
					sessionID: "parent-session",
					status: { type: "idle" },
				},
			},
			streamState,
		);

		expect(idleResult).toEqual({ done: false });

		dispatchServeEvent(
			lifecycle,
			"request-1",
			"parent-session",
			{
				type: "question.replied",
				properties: {
					sessionID: "child-session",
					requestID: "question-child",
				},
			},
			streamState,
		);

		const childDoneResult = dispatchServeEvent(
			lifecycle,
			"request-1",
			"parent-session",
			{
				type: "session.status",
				properties: {
					sessionID: "parent-session",
					status: { type: "idle" },
				},
			},
			streamState,
		);

		expect(childDoneResult).toEqual({ done: true });
	});

	it("polls pending blockers across child and orphan task sessions", async () => {
		const requestServeJson = vi.fn(async (pathname: string) => {
			if (pathname === "/permission") {
				return [
					{
						id: "permission-child",
						sessionID: "child-session",
						permission: "edit",
						patterns: ["src/file.ts"],
						metadata: { description: "Edit src/file.ts" },
					},
				];
			}
			if (pathname === "/question") {
				return [
					{
						id: "question-orphan",
						sessionID: "orphan-task-session",
						questions: [
							{
								header: "Target",
								question: "Pick a target",
								options: [{ label: "Project", description: "Use project" }],
							},
						],
					},
				];
			}
			if (pathname === "/session") {
				return [
					{ id: "parent-session" },
					{ id: "child-session", parentID: "parent-session" },
				];
			}
			return [];
		});
		const posted: unknown[] = [];
		const lifecycle = createLifecycle({
			posted,
			currentRequestId: "request-1",
			requestServeJson,
		});
		const streamState = createServeStreamState();

		await expect(
			pollServeBlockers(lifecycle, "request-1", "parent-session", streamState),
		).resolves.toBe(2);

		expect(posted).toHaveLength(2);
		expect(posted[0]).toMatchObject({
			payload: {
				event: {
					type: "permission",
					permissionId: "permission-child",
					sessionId: "child-session",
					message: "Edit src/file.ts",
				},
			},
		});
		expect(posted[1]).toMatchObject({
			payload: {
				event: {
					type: "question",
					questionId: "question-orphan",
					sessionId: "orphan-task-session",
				},
			},
		});
		expect(streamState.pendingPermissionIds.has("permission-child")).toBe(true);
		expect(streamState.pendingQuestionIds.has("question-orphan")).toBe(true);
	});

	it("按 assistant message id 过滤并转发文本 part", () => {
		const posted: unknown[] = [];
		const lifecycle = createLifecycle({ posted });
		const streamState = createServeStreamState();

		const messageResult = dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.updated",
				properties: {
					info: {
						sessionID: "session-1",
						role: "assistant",
						id: "message-1",
					},
				},
			},
			streamState,
		);

		expect(messageResult).toEqual({ done: false });

		const ignoredResult = dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.part.updated",
				properties: {
					part: {
						sessionID: "session-1",
						messageID: "message-2",
						type: "text",
						text: "忽略",
					},
				},
			},
			streamState,
		);

		expect(ignoredResult).toEqual({ done: false });
		expect(posted).toHaveLength(0);

		const partResult = dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.part.updated",
				properties: {
					part: {
						id: "part-1",
						sessionID: "session-1",
						messageID: "message-1",
						type: "text",
						text: "你好",
					},
				},
			},
			streamState,
		);

		expect(partResult).toEqual({ done: false });
		expect(posted[0]).toMatchObject({
			type: "run.event",
			payload: {
				event: {
					type: "part",
					part: {
						type: "text",
						text: "你好",
					},
				},
			},
		});
	});

	it("把服务端累计文本转换为增量文本和 Thinking 增量", () => {
		const posted: unknown[] = [];
		const lifecycle = createLifecycle({ posted });
		const streamState = createServeStreamState();

		dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.updated",
				properties: {
					info: {
						sessionID: "session-1",
						role: "assistant",
						id: "message-1",
					},
				},
			},
			streamState,
		);

		dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.part.updated",
				properties: {
					part: {
						id: "text-1",
						sessionID: "session-1",
						messageID: "message-1",
						type: "text",
						text: "你",
					},
				},
			},
			streamState,
		);

		dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.part.updated",
				properties: {
					part: {
						id: "text-1",
						sessionID: "session-1",
						messageID: "message-1",
						type: "text",
						text: "你好",
					},
				},
			},
			streamState,
		);

		dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.part.updated",
				properties: {
					part: {
						id: "reasoning-1",
						sessionID: "session-1",
						messageID: "message-1",
						type: "reasoning",
						text: "先",
					},
				},
			},
			streamState,
		);

		dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.part.updated",
				properties: {
					part: {
						id: "reasoning-1",
						sessionID: "session-1",
						messageID: "message-1",
						type: "reasoning",
						text: "先想",
					},
				},
			},
			streamState,
		);

		expect(posted).toHaveLength(4);
		expect(
			posted.map(
				(message) =>
					(message as { payload: { event: { part: { text: string } } } })
						.payload.event.part.text,
			),
		).toEqual(["你", "好", "先", "想"]);
		expect(posted[2]).toMatchObject({
			payload: {
				event: {
					type: "part",
					part: {
						type: "reasoning",
						text: "先",
					},
				},
			},
		});
	});

	it("优先消费 opencode token delta，并用最终 updated 事件去重收尾", () => {
		const posted: unknown[] = [];
		const lifecycle = createLifecycle({ posted });
		const streamState = createServeStreamState();

		dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.updated",
				properties: {
					info: {
						sessionID: "session-1",
						role: "assistant",
						id: "message-1",
					},
				},
			},
			streamState,
		);

		dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.part.updated",
				properties: {
					part: {
						id: "text-1",
						sessionID: "session-1",
						messageID: "message-1",
						type: "text",
						text: "",
					},
				},
			},
			streamState,
		);

		dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.part.delta",
				properties: {
					sessionID: "session-1",
					messageID: "message-1",
					partID: "text-1",
					field: "text",
					delta: "你",
				},
			},
			streamState,
		);

		dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.part.delta",
				properties: {
					sessionID: "session-1",
					messageID: "message-1",
					partID: "text-1",
					field: "text",
					delta: "好",
				},
			},
			streamState,
		);

		dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.part.updated",
				properties: {
					part: {
						id: "text-1",
						sessionID: "session-1",
						messageID: "message-1",
						type: "text",
						text: "你好",
					},
				},
			},
			streamState,
		);

		expect(posted).toHaveLength(2);
		expect(
			posted.map(
				(message) =>
					(message as { payload: { event: { part: { text: string } } } })
						.payload.event.part,
			),
		).toEqual([
			{
				type: "text",
				text: "你",
				streamKey: "message-1:text-1",
			},
			{
				type: "text",
				text: "好",
				streamKey: "message-1:text-1",
			},
		]);
	});

	it("为连续多个 Thinking 保留各自的 messageID 与 partID", () => {
		const posted: unknown[] = [];
		const lifecycle = createLifecycle({ posted });
		const streamState = createServeStreamState();

		dispatchServeEvent(lifecycle, "request-1", "session-1", {
			type: "message.updated",
			properties: {
				info: {
					sessionID: "session-1",
					role: "assistant",
					id: "message-1",
				},
			},
		}, streamState);

		for (const [partID, delta] of [["reasoning-1", "**分析一**"], ["reasoning-2", "**分析二**"]] as const) {
			dispatchServeEvent(lifecycle, "request-1", "session-1", {
				type: "message.part.updated",
				properties: {
					part: {
						id: partID,
						sessionID: "session-1",
						messageID: "message-1",
						type: "reasoning",
						text: "",
					},
				},
			}, streamState);
			dispatchServeEvent(lifecycle, "request-1", "session-1", {
				type: "message.part.delta",
				properties: {
					sessionID: "session-1",
					messageID: "message-1",
					partID,
					field: "text",
					delta,
				},
			}, streamState);
		}

		expect(posted.map((message) => (
			message as { payload: { event: { part: { type: string; text: string; streamKey?: string } } } }
		).payload.event.part)).toEqual([
			{ type: "reasoning", text: "**分析一**", streamKey: "message-1:reasoning-1" },
			{ type: "reasoning", text: "**分析二**", streamKey: "message-1:reasoning-2" },
		]);
	});

	it("delta 早于 part 类型事件到达时，识别类型后再按 token 增量转发", () => {
		const posted: unknown[] = [];
		const lifecycle = createLifecycle({ posted });
		const streamState = createServeStreamState();

		dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.updated",
				properties: {
					info: {
						sessionID: "session-1",
						role: "assistant",
						id: "message-1",
					},
				},
			},
			streamState,
		);

		dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.part.delta",
				properties: {
					sessionID: "session-1",
					messageID: "message-1",
					partID: "reasoning-1",
					field: "text",
					delta: "先想",
				},
			},
			streamState,
		);

		dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.part.updated",
				properties: {
					part: {
						id: "reasoning-1",
						sessionID: "session-1",
						messageID: "message-1",
						type: "reasoning",
						text: "先想",
					},
				},
			},
			streamState,
		);

		expect(posted).toHaveLength(1);
		expect(posted[0]).toMatchObject({
			payload: {
				event: {
					type: "part",
					part: {
						type: "reasoning",
						text: "先想",
					},
				},
			},
		});
	});

	it("从 assistant message.updated 转发 input 与 cache.read 的真实 context 用量", () => {
		const posted: unknown[] = [];
		const lifecycle = createLifecycle({ posted });
		const streamState = createServeStreamState();

		dispatchServeEvent(
			lifecycle,
			"request-1",
			"session-1",
			{
				type: "message.updated",
				properties: {
					info: {
						sessionID: "session-1",
						role: "assistant",
						id: "message-1",
						providerID: "cpa",
						modelID: "gpt-5",
						tokens: {
							input: 1800,
							output: 400,
							cache: { read: 2200, write: 100 },
						},
					},
				},
			},
			streamState,
		);

		expect(posted[0]).toMatchObject({
			payload: {
				event: {
					type: "context.usage",
					usage: { usedTokens: 4000, model: "cpa/gpt-5" },
				},
			},
		});
	});
});
