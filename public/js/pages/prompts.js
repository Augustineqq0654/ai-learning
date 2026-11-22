/* 提示词页：把 dsh-prompt 的预置模板铺成卡片，支持搜索、按域筛选、复制正文。 */

import { $, data, esc, toast } from '../core.js'

let query = ''
let domain = 'all'
let bound = false
const expanded = new Set()

function all() {
  return data.prompts?.items || []
}

function domains() {
  return [...new Set(all().map((p) => p.domain).filter(Boolean))]
}

function matched() {
  const q = query.trim().toLowerCase()
  return all().filter((p) => {
    if (domain !== 'all' && p.domain !== domain) return false
    if (!q) return true
    const hay = [p.name, p.nameEn, p.body, ...(p.labels || [])].join('\n').toLowerCase()
    return hay.includes(q)
  })
}

function renderMeta() {
  const el = $('#prompts-meta')
  if (!el) return
  const prompts = data.prompts
  if (!prompts) {
    el.textContent = '没有读到提示词数据 · 先在终端跑 npm run update:prompts'
    return
  }
  const src = prompts.source ? `${prompts.source.package}@${prompts.source.version}` : 'dsh-prompt'
  el.textContent = `来自本机 ${src} 的 ${prompts.count || all().length} 条预置模板 · 按场景分好类，点右上角「复制」拿走`

  const total = $('#prompt-total')
  if (total) total.textContent = prompts.count || all().length
}

function renderFilters() {
  const box = $('#prompt-filters')
  if (!box) return
  const chips = [{ id: 'all', label: '全部' }, ...domains().map((d) => ({ id: d, label: d }))]
  box.innerHTML = chips
    .map((c) => `<button class="filter ${domain === c.id ? 'on' : ''}" data-domain="${esc(c.id)}">${esc(c.label)}</button>`)
    .join('')

  box.querySelectorAll('.filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      domain = btn.dataset.domain
      renderFilters()
      renderList()
    })
  })
}

function card(p) {
  const open = expanded.has(p.id)
  const tags = [p.domain, p.stage, ...(p.action || [])].filter(Boolean)
  const unique = [...new Set(tags)]
  return `
    <article class="prompt-card ${open ? 'open' : ''}" data-id="${esc(p.id)}">
      <div class="prompt-card-head">
        <div>
          <h3>${esc(p.name)}</h3>
          ${p.nameEn ? `<span class="prompt-name-en">${esc(p.nameEn)}</span>` : ''}
        </div>
        <button class="copy-btn" data-copy="${esc(p.id)}" title="复制正文">复制</button>
      </div>
      <div class="prompt-tags">${unique.map((t) => `<span class="ptag">${esc(t)}</span>`).join('')}</div>
      <p class="prompt-body">${esc(p.body)}</p>
      <button class="expand-btn" data-expand="${esc(p.id)}">${open ? '收起' : '展开全文'}</button>
    </article>`
}

function renderList() {
  const box = $('#prompt-list')
  if (!box) return
  const list = matched()

  const counter = $('#prompt-count')
  if (counter) counter.textContent = list.length === all().length ? '' : `筛出 ${list.length} 条`

  if (!list.length) {
    box.innerHTML = `<div class="empty">没有匹配的模板。换个关键词，或点「全部」。</div>`
    return
  }

  box.innerHTML = list.map(card).join('')

  box.querySelectorAll('[data-expand]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.expand
      if (expanded.has(id)) expanded.delete(id)
      else expanded.add(id)
      renderList()
    })
  })

  box.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const item = all().find((p) => p.id === btn.dataset.copy)
      if (!item) return
      try {
        await navigator.clipboard.writeText(item.body)
        toast(`已复制「${item.name}」`)
      } catch {
        toast('复制失败，浏览器拒绝了剪贴板权限')
      }
    })
  })
}

function bindSearch() {
  if (bound) return
  const input = $('#prompt-search')
  if (!input) return
  bound = true
  input.addEventListener('input', () => {
    query = input.value
    renderList()
  })
}

export function render() {
  renderMeta()
  renderFilters()
  renderList()
  bindSearch()
}
