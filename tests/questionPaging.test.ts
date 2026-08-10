import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getQuestionIndexAfterOption, getQuestionPage } from '../webview-ui/src/questionPaging'

describe('question paging', () => {
  it.each([
    [2, ['1/2', '2/2']],
    [5, ['1/5', '2/5', '3/5', '4/5', '5/5']]
  ] as const)('uses the real total for %i questions', (total, expected) => {
    expect(Array.from({ length: total }, (_, index) => getQuestionPage(index, total).label)).toEqual(expected)
  })

  it('clamps a stale index when a new question request has fewer pages', () => {
    expect(getQuestionPage(4, 2)).toMatchObject({
      index: 1,
      current: 2,
      total: 2,
      label: '2/2',
      hasPrevious: true,
      hasNext: false
    })
  })

  it('advances single-choice answers while keeping multi-choice questions on the same page', () => {
    expect(getQuestionIndexAfterOption(0, 3, false)).toBe(1)
    expect(getQuestionIndexAfterOption(1, 3, undefined)).toBe(2)
    expect(getQuestionIndexAfterOption(0, 3, true)).toBe(0)
    expect(getQuestionIndexAfterOption(2, 3, false)).toBe(2)
  })

  it('renders only the current question with bounded previous and next controls', () => {
    const source = readFileSync(join(process.cwd(), 'webview-ui/src/App.tsx'), 'utf8')
    const start = source.indexOf('function QuestionBanner')
    const end = source.indexOf('export default function App', start)
    const banner = source.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(banner).toContain('const question = pending.questions[page.index]')
    expect(banner).toContain('{page.label}')
    expect(banner).toContain('disabled={!page.hasPrevious}')
    expect(banner).toContain('disabled={!page.hasNext}')
    expect(banner.match(/className="question-banner__question"/g)).toHaveLength(1)
  })
})
