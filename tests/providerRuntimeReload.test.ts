import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('provider runtime reload integration', () => {
  it('保存或删除 provider 后会切换到重新读取配置的 OpenCode runtime', () => {
    const source = readFileSync(join(process.cwd(), 'src/webview/SidebarProvider.ts'), 'utf8')

    expect(source).toContain('restartServeForConfigChange')
    expect(source).toMatch(/syncProviderCredential\(draft\)[\s\S]*restartServeForConfigChange\(\)/)
    expect(source).toMatch(/deleteProviderConfigDraft\([\s\S]*restartServeForConfigChange\(\)/)
  })
})
