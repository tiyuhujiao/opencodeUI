import { posix, win32 } from 'node:path';
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

export function filterSessionsByDirectory<T extends Pick<SessionListItem, 'directory'>>(
  sessions: readonly T[],
  directory: string,
  platform: NodeJS.Platform = process.platform
): T[] {
  const expected = normalizeDirectory(directory, platform);
  return sessions.filter((session) => normalizeDirectory(session.directory, platform) === expected);
}

function normalizeDirectory(directory: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return trimTrailingSeparators(win32.normalize(directory.replace(/\//g, '\\')), '\\').toLowerCase();
  }
  return trimTrailingSeparators(posix.normalize(directory), '/');
}

function trimTrailingSeparators(directory: string, separator: string): string {
  const rootLength = separator === '\\'
    ? win32.parse(directory).root.length
    : posix.parse(directory).root.length;
  let end = directory.length;
  while (end > rootLength && directory[end - 1] === separator) {
    end -= 1;
  }
  return directory.slice(0, end);
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
