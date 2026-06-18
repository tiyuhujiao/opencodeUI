import { describe, expect, it } from 'vitest'
import { resolveSessionSelectionAfterList } from '../webview-ui/src/sessionSelection'

describe('resolveSessionSelectionAfterList', () => {
  it('运行中新 session 暂未出现在列表时仍保持选中', () => {
    expect(
      resolveSessionSelectionAfterList({
        currentSessionId: 'ses_new',
        listedSessionIds: ['ses_old'],
        allowAutoSelect: true,
        protectedSessionId: 'ses_new'
      })
    ).toEqual({
      selectedSessionId: 'ses_new',
      suppressAutoExport: false
    })
  })

  it('刚完成的新 session 暂未出现在列表时仍恢复选中', () => {
    expect(
      resolveSessionSelectionAfterList({
        currentSessionId: null,
        listedSessionIds: ['ses_old'],
        allowAutoSelect: false,
        protectedSessionId: 'ses_new'
      })
    ).toEqual({
      selectedSessionId: 'ses_new',
      suppressAutoExport: false
    })
  })

  it('没有保护中的 session 时保持原有初始加载策略', () => {
    expect(
      resolveSessionSelectionAfterList({
        currentSessionId: null,
        listedSessionIds: ['ses_latest'],
        allowAutoSelect: false
      })
    ).toEqual({
      selectedSessionId: null,
      suppressAutoExport: true
    })
  })

  it('普通已选 session 从列表消失时才清空选中', () => {
    expect(
      resolveSessionSelectionAfterList({
        currentSessionId: 'ses_missing',
        listedSessionIds: ['ses_other'],
        allowAutoSelect: true
      })
    ).toEqual({
      selectedSessionId: null,
      suppressAutoExport: true
    })
  })
})