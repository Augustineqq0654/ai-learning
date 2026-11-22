/* 速览页：数据状态条、分类筛选、新闻列表。 */

import { $, CATEGORIES, data, esc, timeAgo } from '../core.js'

let newsFilter = 'all'

function renderMeta() {
  const el = $('#meta')
  const news = data.news
  if (!el) return
  if (!news) {
    el.textContent = '还没有数据 · 点右上角「更新」抓一次'
    return
  }
  const statuses = Object.values(news.sources || {})
  const okCount = statuses.filter((s) => s === 'ok').length
  const stale = news.stale ? ' · 本轮抓取失败，展示上次数据' : ''
  el.textContent = `数据更新于 ${timeAgo(news.fetchedAt)} · ${okCount}/${statuses.length} 个源可用${stale}`

  const notice = $('#notice')
  if (!notice) return
  if (news.degraded?.length) {
    notice.hidden = false
    notice.innerHTML = `<strong>${news.degraded.length} 个源本次未取到</strong>，页面显示其余源的内容。不影响使用，下次更新会自动重试。`
  } else {
    notice.hidden = true
  }
}

function renderNewsFilters() {
  const box = $('#filters')
  if (!box) return
  const items = data.news?.items || []
  const present = new Set(items.map((i) => i.category))

  const chips = [{ id: 'all', label: '全部' }, ...CATEGORIES.filter((c) => present.has(c.id))]
  box.innerHTML = chips
    .map((c) => `<button class="filter ${newsFilter === c.id ? 'on' : ''}" data-cat="${c.id}">${c.label}</button>`)
    .join('')

  box.querySelectorAll('.filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      newsFilter = btn.dataset.cat
      renderNewsFilters()
      renderNews()
    })
  })
}

function renderNews() {
  const list = $('#news-list')
  if (!list) return
  const news = data.news

  if (!news) {
    list.innerHTML = `<div class="empty">还没有抓到数据。先在终端跑 <code>npm run update</code>，或点右上角「立即更新」。</div>`
    return
  }

  const items = (news.items || []).filter((i) => newsFilter === 'all' || i.category === newsFilter)

  if (!items.length) {
    list.innerHTML = `<div class="empty">这个分类今天没有够格的条目。宁缺毋滥，明天再看。</div>`
    return
  }

  list.innerHTML = items
    .map((item) => {
      const reported = item.summary?.includes('来源在报道')
      const also =
        item.alsoReportedBy?.length > 0 && !reported
          ? `<span class="also">另有 ${item.alsoReportedBy.length} 家报道</span>`
          : ''
      return `
        <article class="news-item">
          <div class="news-top">
            <span class="chip cat-${esc(item.category)}">${esc(item.categoryLabel)}</span>
            <a class="news-title" href="${esc(item.url)}" target="_blank" rel="noreferrer noopener">${esc(item.title)}</a>
          </div>
          <p class="news-summary">${esc(item.summary)}</p>
          <div class="news-meta">
            <span>${esc(item.source)}</span>
            <span>·</span>
            <span>${timeAgo(item.publishedAt)}</span>
            ${also ? `<span>·</span>${also}` : ''}
          </div>
        </article>`
    })
    .join('')
}

export function render() {
  renderMeta()
  renderNewsFilters()
  renderNews()
}
