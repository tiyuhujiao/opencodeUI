import { describe, expect, it } from 'vitest';
import {
  MINIMUM_OPENCODE_VERSION,
  buildOpencodeCompatibility,
  compareSemverVersions,
  parseOpencodeVersionOutput
} from '../src/bridge/opencodeCompatibility';

describe('opencode compatibility checks', () => {
  it('从常见 version 输出中提取 semver', () => {
    expect(parseOpencodeVersionOutput('opencode 1.15.10\n')).toBe('1.15.10');
    expect(parseOpencodeVersionOutput('', 'v1.16.0\n')).toBe('1.16.0');
    expect(parseOpencodeVersionOutput('OpenCode CLI 2.0.0-beta.1')).toBe('2.0.0-beta.1');
  });

  it('比较 semver 并将 prerelease 视为低于正式版本', () => {
    expect(compareSemverVersions('1.16.0', MINIMUM_OPENCODE_VERSION)).toBeGreaterThan(0);
    expect(compareSemverVersions(MINIMUM_OPENCODE_VERSION, MINIMUM_OPENCODE_VERSION)).toBe(0);
    expect(compareSemverVersions('1.15.10-beta.1', MINIMUM_OPENCODE_VERSION)).toBeLessThan(0);
  });

  it('低版本或无法识别版本时返回明确升级提示', () => {
    expect(buildOpencodeCompatibility('opencode', '1.14.0')).toMatchObject({
      isCompatible: false,
      minimumVersion: MINIMUM_OPENCODE_VERSION
    });
    expect(buildOpencodeCompatibility('opencode', '1.14.0').warning).toContain('请升级 opencode');
    expect(buildOpencodeCompatibility('opencode', undefined).warning).toContain('无法识别 opencode 版本');
  });
});
