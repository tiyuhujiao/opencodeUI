import type { SessionListItem } from './sessionListJson';

export function sortSessionsByUpdatedDesc<T extends Pick<SessionListItem, 'updated'>>(sessions: readonly T[]): T[] {
  return sessions.slice().sort((a, b) => compareUpdatedDesc(a.updated, b.updated));
}

export function mergeSessionsById<T extends Pick<SessionListItem, 'id' | 'updated'>>(sessionLists: readonly (readonly T[])[]): T[] {
  const merged = new Map<string, T>();

  for (const sessions of sessionLists) {
    for (const session of sessions) {
      const existing = merged.get(session.id);
      if (!existing || compareUpdatedDesc(session.updated, existing.updated) < 0) {
        merged.set(session.id, session);
      }
    }
  }

  return [...merged.values()];
}

function compareUpdatedDesc(left: string, right: string): number {
  const leftTs = Date.parse(left);
  const rightTs = Date.parse(right);
  const leftValid = Number.isFinite(leftTs);
  const rightValid = Number.isFinite(rightTs);

  if (leftValid && rightValid) {
    return rightTs - leftTs;
  }

  if (leftValid && !rightValid) {
    return -1;
  }

  if (!leftValid && rightValid) {
    return 1;
  }

  return right.localeCompare(left);
}
