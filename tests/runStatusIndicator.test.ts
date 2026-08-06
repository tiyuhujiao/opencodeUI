import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('webview run status indicator', () => {
  it('运行状态固定在顶栏槽位，生命周期变化不再增删独立状态行', () => {
    const source = readFileSync(join(root, 'webview-ui/src/App.tsx'), 'utf8')

    expect(source).toContain('function RunActivityIndicator')
    expect(source).toContain('function RunStatusDetails')
    expect(source).toContain("status === 'Running…'")
    expect(source).toContain("status === 'Completed'")
    expect(source).toContain('className={`run-indicator run-indicator--${activity.kind}`}')
    expect(source).toContain('aria-label={t(activity.label)}')
    expect(source).toContain('<EditedFilesSummary files={files} onOpenFile={onOpenFile} onDismissFile={onDismissFile} />')
    expect(source).toContain('mergeEditedFileSummaries(editedFiles, reviewFiles)')
    expect(source).toContain("type: 'inlineDiff.open'")
    expect(source).toContain("type: 'inlineDiff.dismiss'")
    expect(source).toContain("message.type === 'inlineDiff.state'")
    expect(source).toContain('<RunActivityIndicator status={runStatus} />')
    expect(source).toContain('<RunStatusDetails')
    expect(source).toContain('const message = status && !getRunActivity(status) ? status : null')
    expect(source).toContain('onPointerDownCapture={clearSettledRunIndicator}')
    expect(source).toContain('onKeyDownCapture={clearSettledRunIndicator}')
    expect(source).toContain('function QuestionBanner')
    expect(source).toContain("type: 'question.reply'")
    expect(source).toContain("type: 'question.reject'")
    expect(source).toContain('<QuestionBanner pending={pendingQuestion} onReply={requestQuestionReply} onReject={requestQuestionReject} />')
    expect(source).not.toContain('{runStatus ? <p className="status-line">{runStatus}</p> : null}')
    expect(source).not.toContain('{loadingTranscript ? <p className="empty-line">Loading')
  })

  it('样式层提供运行 spinner 与完成勾选动画', () => {
    const styles = readFileSync(join(root, 'webview-ui/src/styles.css'), 'utf8')

    expect(styles).toContain('.run-indicator--running .run-indicator__icon')
    expect(styles).toContain('.run-activity-slot')
    expect(styles).toContain('flex: 0 0 1.75rem')
    expect(styles).toContain('.run-activity-slot.is-empty')
    expect(styles).toContain('visibility: hidden')
    expect(styles).toContain('animation: run-status-spin')
    expect(styles).toContain('.run-indicator--completed .run-indicator__icon::after')
    expect(styles).toContain('animation: run-status-check')
    expect(styles).toContain('@keyframes run-status-spin')
    expect(styles).toContain('@keyframes run-status-check')
    expect(styles).toContain('translate(-50%, -50%) rotate(45deg)')
    expect(styles).toContain('.edit-summary__item')
    expect(styles).toContain('.edit-summary__dismiss')
    expect(styles).toContain('.edit-summary__item--unavailable')
    expect(styles).toContain('.question-banner')
    expect(styles).toContain('.question-banner__option')
  })
})
