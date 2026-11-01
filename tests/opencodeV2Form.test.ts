import { describe, expect, it, vi } from 'vitest';
import {
  buildV2FormAnswer, isV2FormActive, parseV2Form, validateV2FormAnswer,
  type V2FormField, type V2FormInfo
} from '../src/shared/opencodeV2Form';
import { isExtensionResponseMessage, isWebviewRequestMessage } from '../src/shared/protocol';
import { createOpencodeV2AdapterState, normalizeSessionMessages, requestOpencodeV2Json } from '../src/bridge/opencodeV2Adapter';
import { liveMessagesToTranscript } from '../src/bridge/parsers/exportToTranscript';
import { createServeStreamState, dispatchV2ServeEvent, type RunLifecycleAdapter } from '../src/webview/runLifecycle';

const form: V2FormInfo = {
  id: 'frm_mixed', sessionID: 'ses_root', title: 'Native form', metadata: { kind: 'mcp-elicitation', plugin: { keep: true } },
  fields: [
    { key: 'enabled', type: 'boolean', required: true, default: false },
    { key: 'count', type: 'integer', minimum: 1, maximum: 5, required: true },
    { key: 'ratio', type: 'number', default: 0.5 },
    { key: 'internal', type: 'string', hidden: true, default: 'native-default', required: true },
    { key: 'optional', type: 'string' },
    { key: 'authorization', type: 'external', url: 'https://example.test/authorize' }
  ]
};

function response(data: unknown) {
  return new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
}

describe('OpenCode v2 native forms', () => {
  it('applies hidden and boolean defaults, preserves numeric types, and requires explicit external acknowledgement', () => {
    const answer = buildV2FormAnswer(form.fields, { count: 2, authorization: true });
    expect(answer).toEqual({ enabled: false, count: 2, ratio: 0.5, internal: 'native-default', authorization: true });
    expect(validateV2FormAnswer(form.fields, answer)).toEqual({});
    expect(validateV2FormAnswer(form.fields, { ...answer, authorization: false })).toHaveProperty('authorization');
    expect(buildV2FormAnswer(form.fields, {})).not.toHaveProperty('authorization');
    expect(buildV2FormAnswer(form.fields, { ratio: undefined })).not.toHaveProperty('ratio');
  });

  it('cascades AND conditions and multiselect inclusion, retaining drafts while omitting inactive answers', () => {
    const fields: V2FormField[] = [
      { key: 'mode', type: 'string', default: 'advanced' },
      { key: 'flags', type: 'multiselect', options: [{ value: 'extra', label: 'Extra' }], default: ['extra'] },
      { key: 'detail', type: 'string', default: 'saved', when: [
        { key: 'mode', op: 'eq', value: 'advanced' }, { key: 'flags', op: 'eq', value: 'extra' }
      ] },
      { key: 'child', type: 'boolean', default: false, when: [{ key: 'detail', op: 'neq', value: 'other' }] }
    ];
    expect(buildV2FormAnswer(fields, {})).toEqual({ mode: 'advanced', flags: ['extra'], detail: 'saved', child: false });
    const draft = { mode: 'simple', detail: 'edited', child: true };
    expect(buildV2FormAnswer(fields, draft)).toEqual({ mode: 'simple', flags: ['extra'] });
    expect(buildV2FormAnswer(fields, { ...draft, mode: 'advanced' })).toMatchObject({ detail: 'edited', child: true });
    expect(buildV2FormAnswer(fields, { flags: undefined })).toEqual({ mode: 'advanced' });
    expect(isV2FormActive(fields[3]!, {})).toBe(false);
    expect(validateV2FormAnswer(fields, { mode: 'simple', detail: 'edited' })).toHaveProperty('detail');
  });

  it('matches native required, option, numeric and string constraints without trimming values', () => {
    const fields: V2FormField[] = [
      { key: 'required', type: 'string', required: true },
      { key: 'choice', type: 'string', options: [{ value: 'native', label: 'Display label' }] },
      { key: 'multiple', type: 'multiselect', required: true, options: [], custom: true, minItems: 1, maxItems: 2 },
      { key: 'number', type: 'integer', minimum: 1, maximum: 3 },
      { key: 'email', type: 'string', format: 'email' },
      { key: 'date', type: 'string', format: 'date' },
      { key: 'pattern', type: 'string', pattern: '^ok$', minLength: 2, maxLength: 2 }
    ];
    const good = { required: ' ', choice: 'native', multiple: ['custom'], number: 2, email: 'a@b.test', date: '2024-02-29', pattern: 'ok' };
    expect(validateV2FormAnswer(fields, good)).toEqual({});
    expect(Object.keys(validateV2FormAnswer(fields, {
      required: '', choice: 'Display label', multiple: [], number: 1.5,
      email: 'invalid', date: '2026-02-29', pattern: 'no', unknown: true
    })).sort()).toEqual(['choice', 'date', 'email', 'multiple', 'number', 'pattern', 'required', 'unknown']);
    expect(validateV2FormAnswer(fields, { ...good, number: 4, multiple: ['a', 'b', 'c'] })).toMatchObject({
      number: expect.any(String), multiple: expect.any(String)
    });
  });

  it('preserves the full native form identically through events and API polling', async () => {
    const setPendingQuestion = vi.fn();
    const lifecycle: RunLifecycleAdapter = {
      isCurrentRun: () => true, emit: () => {}, acceptBlockerSession: () => true,
      setPendingPermission: () => {}, setPendingQuestion, requestServeJson: async () => []
    };
    dispatchV2ServeEvent(lifecycle, 'run', 'ses_root', { type: 'form.created', data: { form } }, createServeStreamState());
    const fetcher = vi.fn(async () => response([form]));
    const polled = await requestOpencodeV2Json(createOpencodeV2AdapterState(), fetcher, { baseUrl: 'http://localhost:4096' }, '/question') as any[];
    expect(setPendingQuestion.mock.calls[0]?.[0].form).toEqual(polled[0]?.form);
    expect(polled[0]?.form).toEqual(form);
    expect(parseV2Form({ ...form, fields: [...form.fields, form.fields[0]] })).toBeUndefined();
  });

  it('posts typed native answers unchanged and leaves unacknowledged forms pending', async () => {
    const submitted: unknown[] = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        submitted.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 204 });
      }
      return response(form);
    });
    const state = createOpencodeV2AdapterState();
    const answer = buildV2FormAnswer(form.fields, { count: 3, authorization: true });
    const options = { method: 'POST', body: JSON.stringify({ answer }) };
    await requestOpencodeV2Json(state, fetcher, { baseUrl: 'http://localhost:4096' }, '/question/frm_mixed/reply?sessionID=ses_root', options);
    expect(submitted).toEqual([{ answer }]);
    await expect(requestOpencodeV2Json(state, fetcher, { baseUrl: 'http://localhost:4096' }, '/question/frm_mixed/reply?sessionID=ses_root', {
      ...options, body: JSON.stringify({ answer: { ...answer, authorization: false } })
    })).rejects.toThrow('acknowledged');
    expect(submitted).toHaveLength(1);
    expect(fetcher.mock.calls.every((call) => call[1]?.method !== 'DELETE')).toBe(true);
  });

  it('accepts typed auth/form messages and guards native attempt identity and timing', () => {
    const answer = { enabled: false, count: 2, flags: ['native'] };
    expect(isWebviewRequestMessage({ type: 'question.reply', requestId: 'q', payload: { questionId: form.id, answer } })).toBe(true);
    expect(isWebviewRequestMessage({ type: 'provider.auth.oauth.authorize', requestId: 'a', payload: { providerId: 'p', method: 0, flowId: 'flow', inputs: answer } })).toBe(true);
    expect(isWebviewRequestMessage({ type: 'provider.auth.oauth.cancel', requestId: 'c', payload: { providerId: 'p', method: 0, flowId: 'flow', attemptID: 'con_1' } })).toBe(true);
    expect(isWebviewRequestMessage({ type: 'provider.auth.oauth.cancel', requestId: 'c', payload: { providerId: 'p', method: 0 } })).toBe(false);
    const message = { type: 'provider.auth.oauth.authorize.response', requestId: 'a', ok: true, payload: {
      providerId: 'p', method: 0, flowId: 'flow', authorization: {
        url: 'https://example.test', instructions: '', method: 'code', attemptID: 'con_1', time: { created: 1, expires: 2 }
      }
    } };
    expect(isExtensionResponseMessage(message)).toBe(true);
    expect(isExtensionResponseMessage({ ...message, payload: { ...message.payload, authorization: {
      ...message.payload.authorization, time: { created: 1, expires: 'invalid' }
    } } })).toBe(false);
  });
});

describe('native history outcomes', () => {
  it('marks successful native idle boundaries complete even when the assistant has no finish field', () => {
    const messages = normalizeSessionMessages([
      { id: 'msg_user', type: 'user', text: 'prompt', time: { created: 1 } },
      { id: 'msg_assistant', type: 'assistant', content: [{ type: 'text', text: 'Done' }], time: { created: 2 } },
      { id: 'msg_idle', type: 'idle', outcome: 'succeeded', time: { created: 3 } }
    ], 'ses_root');
    expect(liveMessagesToTranscript(messages)[1]).toMatchObject({ finish: 'stop', completed: 3 });
  });

  it.each(['failed', 'interrupted'])('keeps partial output and the native %s outcome in history and transcript', (outcome) => {
    const messages = normalizeSessionMessages([
      { id: 'msg_user', type: 'user', text: 'prompt', time: { created: 1 } },
      { id: 'msg_assistant', type: 'assistant', content: [{ type: 'text', text: 'Partial output' }],
        error: { type: 'unknown', message: 'Partial failure' }, time: { created: 2 } },
      { id: 'msg_idle', type: 'idle', outcome, ...(outcome === 'failed' ? { error: { type: 'unknown', message: 'Native failure' } } : {}), time: { created: 3 } }
    ], 'ses_root');
    expect(messages).toContainEqual(expect.objectContaining({ info: expect.objectContaining({ id: 'msg_idle', type: 'idle', outcome }) }));
    const transcript = liveMessagesToTranscript(messages);
    expect(transcript.map((message) => message.id)).toEqual(['msg_user', 'msg_assistant']);
    expect(transcript[1]).toMatchObject({ finish: outcome, completed: 3 });
    const text = transcript[1]?.parts.filter((part) => part.type === 'text').map((part) => part.text).join('');
    expect(text).toContain('Partial output');
    expect(text).toContain('Partial failure');
    expect(text).toContain(outcome === 'failed' ? 'Native failure' : '运行已停止');
  });
});
