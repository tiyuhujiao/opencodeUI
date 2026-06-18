import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('session export race protection', () => {
  it('完成后的 session export 只做后台同步', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8')

    expect(source).toContain('requestSessionExport(finalSessionId, { background: true })')
  })

  it('新一轮发送会把当前会话的待完成 export 转为后台请求', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8')

    expect(source).toContain('moveSessionExportsToBackground(selectedSessionId)')
  })

  it('export 回包防覆盖直接依据 activeRunRef，不依赖异步 isRunningRef 更新', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8')

    expect(source).toContain('if (active?.sessionId === targetSessionId)')
    expect(source).not.toContain('isRunningRef.current && active?.sessionId === targetSessionId')
  })
})
