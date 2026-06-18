import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('transcript streaming text styles', () => {
  it('模型输出流式态和最终态复用同一套 Markdown 正文容器', () => {
    const source = readFileSync(join(root, 'webview-ui/src/components/Transcript.tsx'), 'utf8')

    expect(source).not.toContain('stream-text')
    expect(source).toContain("className={`md-body${item.isFinalAnswer && !options.insidePrefinal ? ' md-body--final-answer' : ''}")
  })

  it('聊天正文标题样式限定在气泡内，避免继承页面标题字号', () => {
    const styles = readFileSync(join(root, 'webview-ui/src/styles.css'), 'utf8')

    expect(styles).toContain('.md-body h1')
    expect(styles).toContain('font-size: 1.15rem;')
    expect(styles).not.toContain('.stream-text')
  })
})
