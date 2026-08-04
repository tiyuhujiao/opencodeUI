import MarkdownIt from 'markdown-it'
import { parseFileReference } from '../fileReferences'

const allowedProtocols = ['http://', 'https://']

function isAllowedHttpUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase()
  return allowedProtocols.some((protocol) => normalized.startsWith(protocol))
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

type MarkdownItOptions = NonNullable<ConstructorParameters<typeof MarkdownIt>[0]>

const highlight: NonNullable<MarkdownItOptions['highlight']> = (code, language) => {
  const langClass = language ? ` language-${escapeHtml(language)}` : ''
  return `<pre class="md-code-block"><code class="md-code${langClass}">${escapeHtml(code)}</code></pre>`
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight
})

markdown.validateLink = (url) => isAllowedHttpUrl(url) || Boolean(parseFileReference(url, { allowBareFilename: true }))

const defaultLinkOpen = markdown.renderer.rules.link_open
const defaultLinkClose = markdown.renderer.rules.link_close

type RenderEnv = {
  linkSafetyStack?: Array<'http' | 'file' | 'unsafe'>
}

const linkOpenRule: NonNullable<typeof markdown.renderer.rules.link_open> = (tokens, idx, options, env, self) => {
  const renderEnv = env as RenderEnv
  const linkSafetyStack = renderEnv.linkSafetyStack ?? []
  renderEnv.linkSafetyStack = linkSafetyStack

  const href = tokens[idx].attrGet('href')
  const fileReference = href ? parseFileReference(href, { allowBareFilename: true }) : null
  const linkKind = href && isAllowedHttpUrl(href) ? 'http' : fileReference ? 'file' : 'unsafe'
  linkSafetyStack.push(linkKind)

  if (linkKind === 'unsafe') {
    return '<span>'
  }

  if (fileReference) {
    return `<button type="button" class="file-reference" data-file-path="${escapeHtml(fileReference.path)}"${fileReference.line ? ` data-file-line="${String(fileReference.line)}"` : ''}${fileReference.column ? ` data-file-column="${String(fileReference.column)}"` : ''}>`
  }

  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer nofollow')

  if (defaultLinkOpen) {
    return defaultLinkOpen(tokens, idx, options, env, self)
  }

  return self.renderToken(tokens, idx, options)
}

markdown.renderer.rules.link_open = linkOpenRule

const linkCloseRule: NonNullable<typeof markdown.renderer.rules.link_close> = (tokens, idx, options, env, self) => {
  const renderEnv = env as RenderEnv
  const linkKind = renderEnv.linkSafetyStack?.pop()

  if (linkKind === 'unsafe') {
    return '</span>'
  }

  if (linkKind === 'file') {
    return '</button>'
  }

  if (defaultLinkClose) {
    return defaultLinkClose(tokens, idx, options, env, self)
  }

  return self.renderToken(tokens, idx, options)
}

markdown.renderer.rules.link_close = linkCloseRule

const defaultCodeInline = markdown.renderer.rules.code_inline
markdown.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
  const content = tokens[idx].content
  const fileReference = parseFileReference(content, { allowBareFilename: true })
  if (!fileReference) {
    return defaultCodeInline ? defaultCodeInline(tokens, idx, options, env, self) : `<code>${escapeHtml(content)}</code>`
  }
  return `<button type="button" class="file-reference file-reference--code" data-file-path="${escapeHtml(fileReference.path)}"${fileReference.line ? ` data-file-line="${String(fileReference.line)}"` : ''}${fileReference.column ? ` data-file-column="${String(fileReference.column)}"` : ''}><code>${escapeHtml(content)}</code></button>`
}

const plainFileReferencePattern = /(?:[A-Za-z]:[\\/]|\.{0,2}[\\/])?[A-Za-z0-9_@.+-]+(?:[\\/][A-Za-z0-9_@.+-]+)*\.[A-Za-z0-9]+(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)?/gi
const defaultText = markdown.renderer.rules.text
markdown.renderer.rules.text = (tokens, idx, options, env, self) => {
  const renderEnv = env as RenderEnv
  if ((renderEnv.linkSafetyStack?.length ?? 0) > 0) {
    return defaultText ? defaultText(tokens, idx, options, env, self) : escapeHtml(tokens[idx].content)
  }

  const content = tokens[idx].content
  let cursor = 0
  let rendered = ''
  for (const match of content.matchAll(plainFileReferencePattern)) {
    const label = match[0]
    const start = match.index ?? 0
    const fileReference = parseFileReference(label)
    if (!fileReference) {
      continue
    }
    rendered += escapeHtml(content.slice(cursor, start))
    rendered += `<button type="button" class="file-reference" data-file-path="${escapeHtml(fileReference.path)}"${fileReference.line ? ` data-file-line="${String(fileReference.line)}"` : ''}${fileReference.column ? ` data-file-column="${String(fileReference.column)}"` : ''}>${escapeHtml(label)}</button>`
    cursor = start + label.length
  }

  if (cursor === 0) {
    return defaultText ? defaultText(tokens, idx, options, env, self) : escapeHtml(content)
  }
  return `${rendered}${escapeHtml(content.slice(cursor))}`
}

export function renderMarkdown(markdownText: string): string {
  return markdown.render(markdownText)
}
