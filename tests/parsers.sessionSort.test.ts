import { describe, expect, it } from 'vitest';
import { mergeSessionsById, sortSessionsByUpdatedDesc, type SessionListItem } from '../src/bridge/parsers';

describe('sortSessionsByUpdatedDesc', () => {
  it('按 updated 时间倒序排序（新在前）', () => {
    const sessions: SessionListItem[] = [
      {
        id: 's-1',
        title: 'Older',
        updated: '2026-03-01T10:00:00Z',
        created: '2026-03-01T10:00:00Z',
        projectId: 'p-1',
        directory: '/tmp/a'
      },
      {
        id: 's-2',
        title: 'Newest',
        updated: '2026-03-02T10:00:00Z',
        created: '2026-03-02T10:00:00Z',
        projectId: 'p-1',
        directory: '/tmp/b'
      }
    ];

    const sorted = sortSessionsByUpdatedDesc(sessions);
    expect(sorted.map((session) => session.id)).toEqual(['s-2', 's-1']);
  });

  it('无效日期排在合法日期后，且保持稳定可比较顺序', () => {
    const sessions: SessionListItem[] = [
      {
        id: 's-1',
        title: 'Invalid-A',
        updated: 'bad-date-a',
        created: '2026-03-01T10:00:00Z',
        projectId: 'p-1',
        directory: '/tmp/a'
      },
      {
        id: 's-2',
        title: 'Valid',
        updated: '2026-03-02T10:00:00Z',
        created: '2026-03-02T10:00:00Z',
        projectId: 'p-1',
        directory: '/tmp/b'
      },
      {
        id: 's-3',
        title: 'Invalid-B',
        updated: 'bad-date-b',
        created: '2026-03-03T10:00:00Z',
        projectId: 'p-1',
        directory: '/tmp/c'
      }
    ];

    const sorted = sortSessionsByUpdatedDesc(sessions);
    expect(sorted.map((session) => session.id)).toEqual(['s-2', 's-3', 's-1']);
  });
  it('按 id 合并 workspace 与全局 session，保留更新时间更新的项', () => {
    const workspaceSessions: SessionListItem[] = [
      {
        id: 's-workspace',
        title: 'Workspace',
        updated: '2026-03-03T10:00:00Z',
        created: '2026-03-03T10:00:00Z',
        projectId: 'p-1',
        directory: '/workspace'
      },
      {
        id: 's-shared',
        title: 'Shared New',
        updated: '2026-03-04T10:00:00Z',
        created: '2026-03-01T10:00:00Z',
        projectId: 'p-1',
        directory: '/workspace'
      }
    ];
    const globalSessions: SessionListItem[] = [
      {
        id: 's-global',
        title: 'Global',
        updated: '2026-03-02T10:00:00Z',
        created: '2026-03-02T10:00:00Z',
        projectId: 'p-2',
        directory: '/home/ww'
      },
      {
        id: 's-shared',
        title: 'Shared Old',
        updated: '2026-03-01T10:00:00Z',
        created: '2026-03-01T10:00:00Z',
        projectId: 'p-2',
        directory: '/home/ww'
      }
    ];

    const merged = mergeSessionsById([workspaceSessions, globalSessions]);

    expect(sortSessionsByUpdatedDesc(merged).map((session) => `${session.id}:${session.title}`)).toEqual([
      's-shared:Shared New',
      's-workspace:Workspace',
      's-global:Global'
    ]);
  });
});
