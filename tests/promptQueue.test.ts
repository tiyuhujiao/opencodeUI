import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createOpencodeMessageId,
  createQueuedPrompt,
  removeQueuedPrompt,
  toRunQueueState,
  updateQueuedPromptMessage
} from '../src/webview/promptQueue'

describe('prompt Queue', () => {
  it('preserves FIFO order and clones prompt attachments', () => {
    const files = ['C:/tmp/first.png']
    const first = createQueuedPrompt('queue-1', 100, {
      message: 'first',
      model: 'provider/model',
      agent: 'build',
      files
    })
    const second = createQueuedPrompt('queue-2', 200, {
      message: 'second',
      model: 'provider/model',
      agent: 'build'
    })
    files.push('C:/tmp/mutated.png')

    expect(first.payload.files).toEqual(['C:/tmp/first.png'])
    expect(first.messageId).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    expect(second.messageId).not.toBe(first.messageId)
    expect(toRunQueueState([first, second]).items.map((item) => item.id)).toEqual(['queue-1', 'queue-2'])
  })

  it('generates OpenCode-compatible monotonic message IDs for the same millisecond', () => {
    const first = createOpencodeMessageId(1_700_000_000_000)
    const second = createOpencodeMessageId(1_700_000_000_000)

    expect(first).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    expect(second).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    expect(first.slice(4, 16) < second.slice(4, 16)).toBe(true)
  })

  it('edits and removes queued prompts without mutating the previous queue', () => {
    const first = createQueuedPrompt('queue-1', 100, {
      message: 'first',
      model: 'provider/model',
      agent: 'build'
    })
    const second = createQueuedPrompt('queue-2', 200, {
      message: 'second',
      model: 'provider/model',
      agent: 'build'
    })
    const queue = [first, second]
    const updated = updateQueuedPromptMessage(queue, 'queue-2', '  revised  ')

    expect(updated?.map((item) => item.payload.message)).toEqual(['first', 'revised'])
    expect(queue.map((item) => item.payload.message)).toEqual(['first', 'second'])

    const removed = removeQueuedPrompt(updated ?? [], 'queue-1')
    expect(removed?.removed.id).toBe('queue-1')
    expect(removed?.queue.map((item) => item.id)).toEqual(['queue-2'])
  })

  it('locks a Queue item while OpenCode is preparing to consume it', () => {
    const queued = createQueuedPrompt('queue-1', 100, {
      message: 'follow up',
      model: 'provider/model',
      agent: 'build'
    })

    expect(toRunQueueState([queued]).items[0]).toMatchObject({ locked: false })
    queued.delivery = 'submitted'
    expect(toRunQueueState([queued]).items[0]).toMatchObject({ locked: true })
  })

  it('promotes every submitted Queue item through the assistant parent boundary', () => {
    const source = readFileSync(join(process.cwd(), 'src/webview/SidebarProvider.ts'), 'utf8')
    const observer = source.indexOf('private observeQueuedAssistantMessage(')
    const correlation = source.indexOf('message.parentId === item.messageId', observer)
    const dequeue = source.indexOf('run.queue.splice(0, matchedIndex + 1)', correlation)
    const nextTurn = source.indexOf('this.beginQueuedPromptTurn(webview, requestId, consumed);', dequeue)

    expect(observer).toBeGreaterThan(-1)
    expect(correlation).toBeGreaterThan(observer)
    expect(dequeue).toBeGreaterThan(correlation)
    expect(nextTurn).toBeGreaterThan(dequeue)
  })
})
