import { describe, expect, it, vi } from 'vitest';
import {
  armServeStreamTurn, canCompleteServeStreamTurn, createServeStreamState,
  dispatchV2ServeEvent, pollServeBlockers, type RunLifecycleAdapter
} from '../src/webview/runLifecycle';

function fixture(request = vi.fn(async () => [] as unknown)) {
  const emitted: unknown[] = [];
  const permission = vi.fn();
  const question = vi.fn();
  const adapter: RunLifecycleAdapter = {
    isCurrentRun: () => true,
    emit: (event) => emitted.push(event),
    acceptBlockerSession: () => true,
    setPendingPermission: permission,
    setPendingQuestion: question,
    requestServeJson: request as never
  };
  const state = createServeStreamState();
  armServeStreamTurn(state, { live: true });
  const dispatch = (type: string, data: Record<string, unknown>) =>
    dispatchV2ServeEvent(adapter, 'run', 'ses_root', { type, data }, state);
  return { emitted, permission, question, adapter, state, dispatch, request };
}

function asked(id: string, sessionID = 'ses_root') {
  return { id, sessionID, action: 'bash', resources: ['npm test'] };
}

describe('native blocker ownership and reconciliation', () => {
  it('rejects unrelated and global events even when the adapter accepts every session', () => {
    const f = fixture();
    f.dispatch('permission.asked', asked('per_other', 'ses_other'));
    f.dispatch('form.created', { form: {
      id: 'frm_global', sessionID: 'global', title: 'MCP',
      fields: [{ key: 'name', type: 'string', required: true }]
    } });
    f.dispatch('permission.asked', asked('per_unverified', 'ses_child'));
    expect(f.emitted).toEqual([]);
    f.dispatch('session.created', { sessionID: 'ses_child', parentID: 'ses_root' });
    f.dispatch('session.created', { sessionID: 'ses_grandchild', parentID: 'ses_child' });
    f.dispatch('permission.asked', asked('per_child', 'ses_grandchild'));
    expect(f.permission).toHaveBeenCalledWith(expect.objectContaining({ permissionId: 'per_child' }));
  });

  it('keeps every pending request and advances the visible request only when it resolves', () => {
    const f = fixture();
    for (const id of ['per_1', 'per_2', 'per_3']) f.dispatch('permission.asked', asked(id));
    expect(f.permission).toHaveBeenCalledTimes(1);
    expect(f.state.pendingPermissionIds.size).toBe(3);
    f.dispatch('permission.replied', { sessionID: 'ses_root', requestID: 'per_2' });
    expect(f.permission).toHaveBeenCalledTimes(1);
    f.dispatch('permission.replied', { sessionID: 'ses_root', requestID: 'per_1' });
    expect(f.permission).toHaveBeenLastCalledWith(expect.objectContaining({ permissionId: 'per_3' }));
    expect(canCompleteServeStreamTurn(f.state)).toBe(false);
    f.dispatch('permission.replied', { sessionID: 'ses_root', requestID: 'per_3' });
    expect(f.permission).toHaveBeenLastCalledWith(undefined);
    expect(canCompleteServeStreamTurn(f.state)).toBe(true);
  });

  it('uses native session detail to verify a child absent from the session list', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/permission') return [{ id: 'per_child', sessionID: 'ses_child', permission: 'bash' }];
      if (path === '/question' || path === '/session') return [];
      if (path === '/session/ses_child') return { id: 'ses_child', parentID: 'ses_parent' };
      if (path === '/session/ses_parent') return { id: 'ses_parent', parentID: 'ses_root' };
      throw new Error(path);
    });
    const f = fixture(request);
    await expect(pollServeBlockers(f.adapter, 'run', 'ses_root', f.state)).resolves.toBe(1);
    expect(f.state.pendingPermissionIds.has('per_child')).toBe(true);
    expect(f.state.blockerPollHealthy).toBe(true);
  });

  it('preserves pending state on failed polls and ignores a snapshot overtaken by a reply', async () => {
    const f = fixture(vi.fn(async () => { throw new Error('offline'); }));
    f.dispatch('permission.asked', asked('per_1'));
    await pollServeBlockers(f.adapter, 'run', 'ses_root', f.state);
    expect(f.state.pendingPermissionIds.has('per_1')).toBe(true);
    expect(f.permission).toHaveBeenCalledTimes(1);
    expect(canCompleteServeStreamTurn(f.state)).toBe(false);

    let resolve!: (value: unknown) => void;
    const pending = new Promise((next) => { resolve = next; });
    f.request.mockImplementation(async (path: string) => path === '/permission' ? pending : []);
    const poll = pollServeBlockers(f.adapter, 'run', 'ses_root', f.state);
    f.dispatch('permission.replied', { sessionID: 'ses_root', requestID: 'per_1' });
    resolve([{ id: 'per_1', sessionID: 'ses_root', permission: 'bash' }]);
    await poll;
    expect(f.state.pendingPermissionIds.size).toBe(0);
    expect(f.permission).toHaveBeenLastCalledWith(undefined);
  });
});
