import MarkdownIt from 'markdown-it'

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

markdown.validateLink = isAllowedHttpUrl

const defaultLinkOpen = markdown.renderer.rules.link_open
const defaultLinkClose = markdown.renderer.rules.link_close

type RenderEnv = {
  linkSafetyStack?: boolean[]
}

const linkOpenRule: NonNullable<typeof markdown.renderer.rules.link_open> = (tokens, idx, options, env, self) => {
  const renderEnv = env as RenderEnv
  const linkSafetyStack = renderEnv.linkSafetyStack ?? []
  renderEnv.linkSafetyStack = linkSafetyStack

  const href = tokens[idx].attrGet('href')
  const isSafeLink = Boolean(href && isAllowedHttpUrl(href))
  linkSafetyStack.push(isSafeLink)

  if (!isSafeLink) {
    return '<span>'
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
  const isSafeLink = renderEnv.linkSafetyStack?.pop()

  if (!isSafeLink) {
    return '</span>'
  }

  if (defaultLinkClose) {
    return defaultLinkClose(tokens, idx, options, env, self)
  }

  return self.renderToken(tokens, idx, options)
}

markdown.renderer.rules.link_close = linkCloseRule

export function renderMarkdown(markdownText: string): string {
  return markdown.render(markdownText)
}
