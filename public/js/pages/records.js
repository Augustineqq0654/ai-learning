/* 记录页：读 records/ 里的 Markdown，列表 + 阅读态。数据来自 /api/records。 */

import { $, esc, timeAgo, toast } from '../core.js'

let items = []

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function dirOf(file) {
  const at = file.lastIndexOf('/')
  return at === -1 ? '' : file.slice(0, at + 1)
}

function apiPath(file) {
  return `/api/records/${file.split('/').map(encodeURIComponent).join('/')}`
}

function renderMeta() {
  const el = $('#records-meta')
  if (!el) return
  const total = $('#records-total')
  if (total) total.textContent = items.length || ''
  el.textContent = items.length
    ? `${items.length} 篇 · 按修改时间排，最新的在最前`
    : '还没有记录'
}

function renderList() {
  const box = $('#records-list')
  if (!box) return

  if (!items.length) {
    box.innerHTML = `<div class="empty">records/ 里还是空的。把 .md 文件丢进项目根目录的 <code>records</code> 文件夹，刷新这一页就能看到。</div>`
    return
  }

  box.innerHTML = items
    .map((item) => {
      const dir = dirOf(item.file)
      const meta = [timeAgo(item.updatedAt), fmtSize(item.size), dir ? dir.replace(/\/$/, '') : '']
        .filter(Boolean)
        .join(' · ')
      return `
        <button class="record-card" data-file="${esc(item.file)}">
          <span class="record-title">${esc(item.title)}</span>
          <span class="record-excerpt">${esc(item.excerpt || '（还没有正文）')}</span>
          <span class="record-meta">${esc(meta)}</span>
        </button>`
    })
    .join('')

  box.querySelectorAll('.record-card').forEach((card) => {
    card.addEventListener('click', () => openDoc(card.dataset.file, true))
  })
}

function showList() {
  const listView = $('#records-list-view')
  const view = $('#record-view')
  if (listView) listView.hidden = false
  if (view) view.hidden = true
  document.title = '记录 · AI 学习驾驶舱'
}

async function openDoc(file, push) {
  try {
    const res = await fetch(apiPath(file), { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const doc = await res.json()

    const listView = $('#records-list-view')
    const view = $('#record-view')
    const body = $('#record-body')
    const meta = $('#record-meta')
    if (!listView || !view || !body) return

    listView.hidden = true
    view.hidden = false
    body.innerHTML = doc.html || '<p class="empty">这篇是空的。</p>'
    if (meta) meta.textContent = `${doc.file} · ${timeAgo(doc.updatedAt)} · ${fmtSize(doc.size)}`
    document.title = `${doc.title} · 记录`
    window.scrollTo({ top: 0 })

    if (push) {
      const url = new URL(location.href)
      url.searchParams.set('doc', doc.file)
      history.pushState({ doc: doc.file }, '', url)
    }
  } catch (err) {
    toast(`打不开这篇：${err.message}`)
  }
}

function currentDoc() {
  return new URLSearchParams(location.search).get('doc')
}

export function render() {
  // 记录页不需要「更新」新闻，把导航上的按钮藏掉
  const refresh = $('#refresh')
  if (refresh) refresh.hidden = true

  const back = $('#record-back')
  if (back) {
    back.addEventListener('click', () => {
      showList()
      const url = new URL(location.href)
      url.searchParams.delete('doc')
      history.pushState({}, '', url)
      loadList()
    })
  }

  window.addEventListener('popstate', () => {
    const doc = currentDoc()
    if (doc) openDoc(doc, false)
    else showList()
  })

  const doc = currentDoc()
  if (doc) openDoc(doc, false)
  loadList()
}

async function loadList() {
  try {
    const res = await fetch('/api/records', { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const payload = await res.json()
    items = payload.items || []
    renderMeta()
    renderList()
  } catch (err) {
    const box = $('#records-list')
    if (box) box.innerHTML = `<div class="empty">读取 records/ 失败：${esc(err.message)}</div>`
  }
}
