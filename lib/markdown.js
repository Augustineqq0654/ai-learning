/**
 * lib/markdown.js
 * 极简 Markdown → HTML，只服务 records/ 里的学习笔记。
 *
 * 支持的语法：标题、段落、无序/有序列表（含任务清单）、引用、代码块（带语言标记）、
 * 行内代码、加粗、斜体、删除线、链接、图片、分隔线、表格。
 * 默认转义 HTML（原样输出标签），不执行也不放行内联 HTML。
 */

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (ch) => ESCAPES[ch])

/** Windows 编辑器常写 BOM，先剥掉，否则首个标题会被当成普通段落 */
const stripBom = (text) => String(text ?? '').replace(/^\uFEFF/, '')

const CJK = /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/

/** 中文之间不补空格，西文之间补一个空格 */
function joinParagraph(lines) {
  return lines.reduce((acc, raw) => {
    const line = raw.trim()
    if (!acc) return line
    if (!line) return acc
    const glue = CJK.test(acc.slice(-1)) && CJK.test(line[0]) ? '' : ' '
    return acc + glue + line
  }, '')
}

/** 安全的内联链接目标：只放行 http(s)、mailto、站内相对路径 */
function safeUrl(url) {
  const value = String(url).trim()
  if (/^(https?:|mailto:)/i.test(value)) return value
  if (/^[./#?]/.test(value)) return value
  return null
}

/** 行内语法；入参必须已经过 escapeHtml */
function inline(escaped) {
  const codes = []
  let text = escaped.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${code}</code>`)
    return `\u0000${codes.length - 1}\u0000`
  })

  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (match, alt, url) => {
    const href = safeUrl(url)
    return href ? `<img src="${href}" alt="${alt}" loading="lazy" />` : match
  })

  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (match, label, url) => {
    const href = safeUrl(url)
    if (!href) return match
    const external = /^https?:/i.test(href) ? ' target="_blank" rel="noreferrer noopener"' : ''
    return `<a href="${href}"${external}>${label}</a>`
  })

  text = text
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')

  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => codes[Number(index)] || '')
}

const isBlank = (line) => !line || !line.trim()
const isHeading = (line) => /^#{1,6}\s+/.test(line)
const isFence = (line) => /^\s*```/.test(line)
const isQuote = (line) => /^\s*>\s?/.test(line)
const isRule = (line) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)
const isListItem = (line) => /^\s*([-*+]|\d+[.)])\s+/.test(line)
const isTableHead = (line, next) =>
  typeof line === 'string' &&
  line.includes('|') &&
  typeof next === 'string' &&
  /^\s*\|?[\s:|-]+\|?\s*$/.test(next) &&
  next.includes('-')

/** 一行是否开启一个新块（段落在这里断开） */
function startsBlock(line, next) {
  return (
    isBlank(line) ||
    isFence(line) ||
    isHeading(line) ||
    isQuote(line) ||
    isRule(line) ||
    isListItem(line) ||
    isTableHead(line, next)
  )
}

function splitRow(row) {
  let text = row.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|')) text = text.slice(0, -1)
  return text.split('|').map((cell) => cell.trim())
}

function renderTable(headerLine, separatorLine, bodyLines) {
  const head = splitRow(headerLine)
  const aligns = splitRow(separatorLine).map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return ''
  })
  const alignAttr = (index) => (aligns[index] ? ` style="text-align:${aligns[index]}"` : '')
  const cell = (tag, value, index) => `<${tag}${alignAttr(index)}>${inline(escapeHtml(value))}</${tag}>`

  const headRow = `<tr>${head.map((c, i) => cell('th', c, i)).join('')}</tr>`
  const bodyRows = bodyLines
    .map((line) => `<tr>${splitRow(line).map((c, i) => cell('td', c, i)).join('')}</tr>`)
    .join('')

  return `<table><thead>${headRow}</thead><tbody>${bodyRows}</tbody></table>`
}

export function renderMarkdown(source) {
  const lines = stripBom(source).replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const next = lines[i + 1]

    if (isBlank(line)) {
      i += 1
      continue
    }

    // 代码块：原样保留，不做行内解析
    if (isFence(line)) {
      const lang = (line.match(/^\s*```(\S*)/) || [])[1] || ''
      const body = []
      i += 1
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : ''
      out.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }

    if (isHeading(line)) {
      const [, hashes, text] = line.match(/^(#{1,6})\s+(.*)$/)
      const level = hashes.length
      out.push(`<h${level}>${inline(escapeHtml(text.trim()))}</h${level}>`)
      i += 1
      continue
    }

    if (isRule(line)) {
      out.push('<hr />')
      i += 1
      continue
    }

    // 引用：剥掉 > 后递归
    if (isQuote(line)) {
      const body = []
      while (i < lines.length && isQuote(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`)
      continue
    }

    // 表格：表头 + 分隔行 + 连续数据行
    if (isTableHead(line, next)) {
      const header = line
      const separator = next
      const body = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && !isBlank(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      out.push(renderTable(header, separator, body))
      continue
    }

    // 列表：逐项收集，缩进行并入上一项
    if (isListItem(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items = []
      while (i < lines.length) {
        const current = lines[i]
        const itemMatch = current.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/)
        if (itemMatch) {
          let text = itemMatch[2]
          const task = text.match(/^\[([ xX])\]\s+(.*)$/)
          const checkbox = task ? (task[1].toLowerCase() === 'x' ? '☑ ' : '☐ ') : ''
          const content = task ? task[2] : text
          i += 1
          const continuation = []
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !isListItem(lines[i])) {
            continuation.push(lines[i].trim())
            i += 1
          }
          items.push(`<li>${checkbox}${inline(escapeHtml(joinParagraph([content, ...continuation])))}</li>`)
          continue
        }
        break
      }
      const tag = ordered ? 'ol' : 'ul'
      // 兜底：万一没收集到条目，也要推进，避免原地打转
      if (!items.length) i += 1
      out.push(`<${tag}>${items.join('')}</${tag}>`)
      continue
    }

    // 段落：收集到下一个空行或块起点
    const body = []
    while (i < lines.length && !startsBlock(lines[i], lines[i + 1])) {
      body.push(lines[i])
      i += 1
    }
    if (body.length) out.push(`<p>${inline(escapeHtml(joinParagraph(body)))}</p>`)
    else i += 1
  }

  return out.join('\n')
}

/** 纯文本摘要：去掉常见 Markdown 记号，用于列表页 */
export function plainText(source, max = 90) {
  const text = stripBom(source)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[[ xX]\]/g, ' ')
    .replace(/^\s*(\d+[.)]|[-*+])\s+/gm, ' ')
    .replace(/[#>*_~`|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}
