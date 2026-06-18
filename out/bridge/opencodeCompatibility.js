"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MINIMUM_OPENCODE_VERSION = void 0;
exports.parseOpencodeVersionOutput = parseOpencodeVersionOutput;
exports.compareSemverVersions = compareSemverVersions;
exports.buildOpencodeCompatibility = buildOpencodeCompatibility;
exports.MINIMUM_OPENCODE_VERSION = '1.15.10';
function parseOpencodeVersionOutput(stdout, stderr = '') {
    const text = `${stdout}\n${stderr}`;
    const match = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+[0-9A-Za-z.-]+)?\b/.exec(text);
    return match?.[1];
}
function compareSemverVersions(left, right) {
    const a = parseSemver(left);
    const b = parseSemver(right);
    for (const key of ['major', 'minor', 'patch']) {
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
function buildOpencodeCompatibility(binary, version, warning) {
    if (!version) {
        return {
            binary,
            minimumVersion: exports.MINIMUM_OPENCODE_VERSION,
            isCompatible: false,
            warning: warning ?? `无法识别 opencode 版本，请确认已安装 opencode ${exports.MINIMUM_OPENCODE_VERSION} 或更新版本。`
        };
    }
    const isCompatible = compareSemverVersions(version, exports.MINIMUM_OPENCODE_VERSION) >= 0;
    return {
        binary,
        version,
        minimumVersion: exports.MINIMUM_OPENCODE_VERSION,
        isCompatible,
        warning: isCompatible
            ? warning
            : `当前 opencode ${version} 低于已验证版本 ${exports.MINIMUM_OPENCODE_VERSION}，请升级 opencode 后再继续使用。`
    };
}
function parseSemver(version) {
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
//# sourceMappingURL=opencodeCompatibility.js.map