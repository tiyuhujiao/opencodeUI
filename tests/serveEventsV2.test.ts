import { describe, expect, it, vi } from 'vitest';
import {
  armServeStreamTurn,
  createServeStreamState,
  dispatchV2ServeEvent,
  type RunLifecycleAdapter
} from '../src/webview/runLifecycle';

function createLifecycle(posted: unknown[]) {
  const pendingPermission = vi.fn();
  const pendingQuestion = vi.fn();
  const userMessages = vi.fn();
  const assistantMessages = vi.fn();
  const lifecycle: RunLifecycleAdapter = {
    isCurrentRun: () => true,
    emit: (event) => posted.push(event),
    onUserMessage: userMessages,
    onAssistantMessage: assistantMessages,
    acceptBlockerSession: (_requestId, sessionId, blockerSessionId) =>
      blockerSessionId === sessionId || blockerSessionId === 'ses_child',
    setPendingPermission: pendingPermission,
    setPendingQuestion: pendingQuestion,
    requestServeJson: async () => []
  };
  return {
    lifecycle,
    pendingPermission,
    pendingQuestion,
    userMessages,
    assistantMessages
  };
}

function envelope(type: string, data: Record<string, unknown>, created = 1) {
  return { id: `evt_${type}`, type, created, data };
}

describe('OpenCode V2 run events', () => {
  it('converts V2 text, reasoning, usage, and execution events into stream events', () => {
    const posted: unknown[] = [];
    const { lifecycle, userMessages, assistantMessages } = createLifecycle(posted);
    const state = createServeStreamState();
    armServeStreamTurn(state);

    dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('session.inbox.delivered', {
        sessionID: 'ses_1',
        inboxID: 'msg_user_1'
      }),
      state
    );
    dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('session.execution.started', { sessionID: 'ses_1' }),
      state
    );
    dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('session.step.started', {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_assistant_1',
        model: { providerID: 'openai', id: 'gpt-5' }
      }),
      state
    );
    dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('session.reasoning.started', {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_assistant_1',
        ordinal: 0
      }),
      state
    );
    dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('session.reasoning.delta', {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_assistant_1',
        ordinal: 0,
        delta: 'Thinking'
      }),
      state
    );
    dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('session.text.started', {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_assistant_1',
        ordinal: 1
      }),
      state
    );
    dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('session.text.delta', {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_assistant_1',
        ordinal: 1,
        delta: 'Done'
      }),
      state
    );
    dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('session.step.ended', {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_assistant_1',
        model: { providerID: 'openai', id: 'gpt-5' },
        tokens: {
          input: 10,
          output: 2,
          reasoning: 1,
          cache: { read: 3, write: 0 }
        }
      }),
      state
    );
    const terminal = dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('session.execution.succeeded', { sessionID: 'ses_1' }),
      state
    );

    expect(terminal).toEqual({ done: true });
    expect(userMessages).toHaveBeenCalledWith({ id: 'msg_user_1' });
    expect(assistantMessages).toHaveBeenCalledWith({
      id: 'msg_assistant_1',
      parentId: 'msg_user_1'
    });
    expect(posted).toContainEqual({
      type: 'part',
      part: {
        type: 'reasoning',
        text: 'Thinking',
        streamKey: 'msg_assistant_1:reasoning:0',
        raw: expect.any(Object)
      }
    });
    expect(posted).toContainEqual({
      type: 'part',
      part: {
        type: 'text',
        text: 'Done',
        streamKey: 'msg_assistant_1:text:1'
      }
    });
    expect(posted).toContainEqual({
      type: 'context.usage',
      usage: {
        usedTokens: 13,
        model: 'openai/gpt-5'
      }
    });
  });

  it('surfaces V2 tool, permission, and question lifecycle updates', () => {
    const posted: unknown[] = [];
    const {
      lifecycle,
      pendingPermission,
      pendingQuestion
    } = createLifecycle(posted);
    const state = createServeStreamState();
    armServeStreamTurn(state);

    dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('session.tool.input.started', {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_assistant_1',
        id: 'tool_1',
        name: 'read'
      }),
      state
    );
    dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('session.tool.called', {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_assistant_1',
        id: 'tool_1',
        input: { filePath: 'README.md' },
        executed: true
      }),
      state
    );
    dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('session.tool.success', {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_assistant_1',
        id: 'tool_1',
        content: [{ type: 'text', text: 'body' }],
        executed: true
      }),
      state
    );

    const permission = dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('permission.asked', {
        id: 'per_1',
        sessionID: 'ses_1',
        action: 'bash',
        resources: ['npm test']
      }),
      state
    );
    const question = dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('form.created', {
        form: {
          id: 'frm_1',
          sessionID: 'ses_1',
          title: 'Questions',
          metadata: { kind: 'question' },
          fields: [
            {
              key: 'q0',
              type: 'string',
              title: 'File',
              description: 'Which file?',
              options: [{ value: 'README.md', label: 'README.md' }]
            },
            {
              key: 'hidden',
              type: 'string',
              title: 'Hidden',
              description: 'Internal',
              hidden: true
            }
          ]
        }
      }),
      state
    );

    expect(permission).toEqual({ done: false });
    expect(question).toEqual({ done: false });
    expect(pendingPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'permission',
        permissionId: 'per_1',
        toolName: 'bash',
        patterns: ['npm test']
      })
    );
    expect(pendingQuestion).toHaveBeenCalledWith(expect.objectContaining({
      type: 'question',
      questionId: 'frm_1',
      sessionId: 'ses_1',
      questions: [
        {
          header: 'File',
          question: 'Which file?',
          options: [
            {
              label: 'README.md',
              description: 'README.md'
            }
          ],
          multiple: false,
          custom: false
        }
      ]
    }));
    expect(state.pendingPermissionIds.has('per_1')).toBe(true);
    expect(state.pendingQuestionIds.has('frm_1')).toBe(true);
    expect(posted).toContainEqual({
      type: 'part',
      part: expect.objectContaining({
        type: 'tool',
        toolName: 'read',
        status: 'completed',
        raw: expect.objectContaining({
          id: 'tool_1',
          state: expect.objectContaining({
            input: { filePath: 'README.md' },
            output: 'body'
          })
        })
      })
    });

    dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('permission.replied', {
        sessionID: 'ses_1',
        requestID: 'per_1',
        reply: 'once'
      }),
      state
    );
    dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('form.replied', {
        sessionID: 'ses_1',
        id: 'frm_1',
        answer: { q0: 'README.md' }
      }),
      state
    );
    expect(state.pendingPermissionIds.size).toBe(0);
    expect(state.pendingQuestionIds.size).toBe(0);
  });

  it('reports structured execution failures', () => {
    const posted: unknown[] = [];
    const { lifecycle } = createLifecycle(posted);
    const state = createServeStreamState();

    const result = dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('session.execution.failed', {
        sessionID: 'ses_1',
        error: {
          type: 'ProviderError',
          message: 'Provider unavailable'
        }
      }),
      state
    );

    expect(result).toEqual({ done: true, error: 'Provider unavailable' });
    expect(posted).toContainEqual({
      type: 'error',
      error: 'Provider unavailable'
    });
  });

  it('accepts child-session blockers and reports non-user interruptions', () => {
    const posted: unknown[] = [];
    const { lifecycle, pendingPermission } = createLifecycle(posted);
    const state = createServeStreamState();
    armServeStreamTurn(state);
    dispatchV2ServeEvent(lifecycle, 'request-1', 'ses_parent', envelope('session.created', {
      sessionID: 'ses_child', parentID: 'ses_parent'
    }), state);

    const permission = dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_parent',
      envelope('permission.asked', {
        id: 'per_child',
        sessionID: 'ses_child',
        action: 'bash',
        resources: ['npm test']
      }),
      state
    );
    const interrupted = dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_parent',
      envelope('session.execution.interrupted', {
        sessionID: 'ses_parent',
        reason: 'shutdown'
      }),
      state
    );

    expect(permission).toEqual({ done: false });
    expect(pendingPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionId: 'per_child',
        sessionId: 'ses_child'
      })
    );
    expect(interrupted).toEqual({
      done: true,
      error: 'Session interrupted: shutdown'
    });
    expect(posted).toContainEqual({
      type: 'error',
      error: 'Session interrupted: shutdown'
    });
  });

  it('keeps step failures non-terminal so retries can continue', () => {
    const posted: unknown[] = [];
    const { lifecycle } = createLifecycle(posted);
    const state = createServeStreamState();

    const stepFailure = dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('session.step.failed', {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_1',
        error: { message: 'Provider rate limited' }
      }),
      state
    );
    const retry = dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('session.retry.scheduled', {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_1',
        attempt: 1,
        at: 1,
        error: { message: 'Provider rate limited' }
      }),
      state
    );
    const executionFailure = dispatchV2ServeEvent(
      lifecycle,
      'request-1',
      'ses_1',
      envelope('session.execution.failed', {
        sessionID: 'ses_1',
        error: { message: 'Provider rate limited' }
      }),
      state
    );

    expect(stepFailure).toEqual({ done: false });
    expect(retry).toEqual({ done: false });
    expect(executionFailure).toEqual({
      done: true,
      error: 'Provider rate limited'
    });
    expect(posted).toEqual([
      { type: 'error', error: 'Provider rate limited' }
    ]);
  });

  it('replaces retried text instead of appending it', () => {
    const posted: unknown[] = [];
    const { lifecycle } = createLifecycle(posted);
    const state = createServeStreamState();
    armServeStreamTurn(state);
    const dispatch = (type: string, data: Record<string, unknown>) =>
      dispatchV2ServeEvent(
        lifecycle,
        'request-1',
        'ses_1',
        envelope(type, {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          ordinal: 0,
          ...data
        }),
        state
      );

    dispatch('session.text.started', {});
    dispatch('session.text.delta', { delta: 'hel' });
    dispatch('session.text.started', {});
    dispatch('session.text.delta', { delta: 'hello' });

    expect(posted).toEqual([
      { type: 'part', part: { type: 'text', text: 'hel', streamKey: 'msg_1:text:0' } },
      {
        type: 'part',
        part: { type: 'text', text: '', streamKey: 'msg_1:text:0', replace: true }
      },
      { type: 'part', part: { type: 'text', text: 'hello', streamKey: 'msg_1:text:0' } }
    ]);
  });

  it('replaces authoritative text that is not a prefix extension', () => {
    const posted: unknown[] = [];
    const { lifecycle } = createLifecycle(posted);
    const state = createServeStreamState();
    armServeStreamTurn(state);
    const dispatch = (type: string, data: Record<string, unknown>) =>
      dispatchV2ServeEvent(
        lifecycle,
        'request-1',
        'ses_1',
        envelope(type, {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          ordinal: 0,
          ...data
        }),
        state
      );

    dispatch('session.text.started', {});
    dispatch('session.text.delta', { delta: 'partial answer' });
    dispatch('session.text.ended', { text: 'final answer' });

    expect(posted).toContainEqual({
      type: 'part',
      part: {
        type: 'text',
        text: 'final answer',
        streamKey: 'msg_1:text:0',
        replace: true
      }
    });
  });
});
