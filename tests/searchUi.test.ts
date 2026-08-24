import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('search highlight lifecycle', () => {
  it('current search supports cyclic keyboard movement while history search clears from surrounding blank space', () => {
    const app = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8')
    const transcript = readFileSync(join(root, 'webview-ui/src/components/Transcript.tsx'), 'utf8')
    const dialog = readFileSync(join(root, 'webview-ui/src/components/dialog/SessionDialog.tsx'), 'utf8')
    const styles = readFileSync(join(root, 'webview-ui/src/styles.css'), 'utf8')

    expect(app).toContain("setSessionFindOpen(false)")
    expect(app).toContain("setSessionFindQuery('')")
    expect(app).toContain("event.key === 'ArrowUp'")
    expect(app).toContain("event.key === 'ArrowDown'")
    expect(app).toContain('className="find-widget"')
    expect(app).toContain('event.target === sessionFindInputRef.current')
    expect(app).toContain('clearSearchOnBlankClick={historySearchActiveForSelected && !sessionFindOpen}')
    expect(app).toContain("document.addEventListener('pointerdown', onOutsidePointerDown, true)")
    expect(app).toContain("target?.closest('.transcript, .find-widget, .session-search, .overlay')")
    expect(transcript).toContain("'mark.search-hit, .image-part, pre, code, [data-file-path], button, a, input, textarea, select'")
    expect(transcript).toContain('isPointInsideRenderedText(elementTarget, event.clientX, event.clientY)')
    expect(transcript).not.toContain("'mark.search-hit, .msg, .msg__content")
    expect(dialog).toContain('<mark className="search-hit">')
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) auto auto auto auto auto auto auto;')
    expect(styles).toContain('background: rgba(255, 235, 59, 0.52);')
  })
})
