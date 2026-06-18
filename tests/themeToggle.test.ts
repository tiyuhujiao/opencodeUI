import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('webview theme toggle', () => {
  it('默认使用白色主题，并将用户选择持久化到 webview 本地存储', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8')

    expect(source).toContain("type ThemeMode = 'light' | 'dark'")
    expect(source).toContain("const THEME_STORAGE_KEY = 'opencode-ui.theme'")
    expect(source).toContain("return stored === 'dark' ? 'dark' : 'light'")
    expect(source).toContain('useState<ThemeMode>(() => readInitialTheme())')
    expect(source).toContain('document.documentElement.dataset.theme = themeMode')
    expect(source).toContain('window.localStorage.setItem(THEME_STORAGE_KEY, themeMode)')
  })

  it('顶部区域在连接状态左侧提供太阳图标主题按钮', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8')

    expect(source).toContain('className="theme-toggle"')
    expect(source).toContain("setThemeMode((current) => (current === 'light' ? 'dark' : 'light'))")
    expect(source).toContain("aria-label={themeMode === 'light' ? '切换到黑色主题' : '切换到白色主题'}")
    expect(source).toContain('<span className="theme-toggle__icon" aria-hidden="true">☀</span>')
    expect(source.indexOf('className="theme-toggle"')).toBeLessThan(source.indexOf('className="topbar__status"'))
  })

  it('样式层提供白色和黑色两套主题变量', () => {
    const styles = readFileSync(join(root, 'webview-ui/src/styles.css'), 'utf8')

    expect(styles).toContain(":root[data-theme='light']")
    expect(styles).toContain(":root[data-theme='dark']")
    expect(styles).toContain('color-scheme: light;')
    expect(styles).toContain('color-scheme: dark;')
    expect(styles).toContain('--ui-body-bg:')
    expect(styles).toContain('--ui-topbar-bg:')
    expect(styles).toContain('--ui-composer-bg:')
    expect(styles).toContain('--ui-composer-input-bg:')
  })
})