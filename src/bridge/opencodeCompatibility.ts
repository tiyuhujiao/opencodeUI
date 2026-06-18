import type { OpencodeCompatibility } from '../shared/protocol';

export const MINIMUM_OPENCODE_VERSION = '1.15.10';

type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
};

export function parseOpencodeVersionOutput(stdout: string, stderr = ''): string | undefined {
  const text = `${stdout}\n${stderr}`;
  const match = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+[0-9A-Za-z.-]+)?\b/.exec(text);
  return match?.[1];
}

export function compareSemverVersions(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);

  for (const key of ['major', 'minor', 'patch'] as const) {
    const diff = a[key] - b[key];
    if (diff !== 0) {
      return diff;
    }
  }

  if (a.prerelease && !b.prerelease) {
    return -1;
  }

  if (!a.prerelease && b.prerelease) {
    return 1;
  }

  return a.prerelease.localeCompare(b.prerelease);
}

export function buildOpencodeCompatibility(
  binary: string,
  version: string | undefined,
  warning?: string
): OpencodeCompatibility {
  if (!version) {
    return {
      binary,
      minimumVersion: MINIMUM_OPENCODE_VERSION,
      isCompatible: false,
      warning: warning ?? `无法识别 opencode 版本，请确认已安装 opencode ${MINIMUM_OPENCODE_VERSION} 或更新版本。`
    };
  }

  const isCompatible = compareSemverVersions(version, MINIMUM_OPENCODE_VERSION) >= 0;

  return {
    binary,
    version,
    minimumVersion: MINIMUM_OPENCODE_VERSION,
    isCompatible,
    warning: isCompatible
      ? warning
      : `当前 opencode ${version} 低于已验证版本 ${MINIMUM_OPENCODE_VERSION}，请升级 opencode 后再继续使用。`
  };
}

function parseSemver(version: string): ParsedSemver {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim());
  if (!match) {
    return {
      major: 0,
      minor: 0,
      patch: 0,
      prerelease: version
    };
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? ''
  };
}
