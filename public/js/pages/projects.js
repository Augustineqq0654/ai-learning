/* 项目库页：今日新发现（GitHub Trending）+ 项目卡片与阶段筛选。 */

import { $, data, esc } from '../core.js'

let projectFilter = 'all'

function renderDiscoveries() {
  const block = $('#discoveries-block')
  const box = $('#discoveries')
  if (!block || !box) return
  const list = data.news?.discoveries || []

  if (!list.length) {
    block.hidden = true
    return
  }

  block.hidden = false
  box.innerHTML = list
    .map(
      (d) => `
      <a class="discovery" href="${esc(d.url)}" target="_blank" rel="noreferrer noopener">
        <span class="repo">${esc(d.title)}</span>
        <span class="repo-desc">${esc(d.description || '（仓库暂无简介）')}</span>
      </a>`
    )
    .join('')
}

function renderProjects() {
  const box = $('#project-list')
  const filterBox = $('#project-filters')
  if (!box || !filterBox) return

  const all = data.projects?.projects || []

  const countEl = $('#project-count')
  if (countEl) countEl.textContent = all.length ? `(${all.length})` : ''

  const stageIds = [...new Set(all.map((p) => p.stage))].sort((a, b) => a - b)
  const chips = [{ id: 'all', label: '全部' }, ...stageIds.map((id) => ({ id: String(id), label: `阶段 ${id}` }))]
  filterBox.innerHTML = chips
    .map((c) => `<button class="filter ${projectFilter === c.id ? 'on' : ''}" data-stage="${c.id}">${c.label}</button>`)
    .join('')

  filterBox.querySelectorAll('.filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      projectFilter = btn.dataset.stage
      renderProjects()
    })
  })

  const list = all.filter((p) => projectFilter === 'all' || String(p.stage) === projectFilter)

  if (!list.length) {
    box.innerHTML = `<div class="empty">这里还没有内容。</div>`
    return
  }

  box.innerHTML = list
    .map((p) => {
      const refs = (p.refs || [])
        .map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noreferrer noopener">${esc(r.label)}</a>`)
        .join('')
      const payoff = p.payoff || p.value || ''

      return `
      <article class="project">
        <h4>${esc(p.title)}</h4>
        <p class="problem">${esc(p.problem || '')}</p>
        <p class="one-liner">${esc(p.oneLiner)}</p>
        <div class="tags">
          <span class="stars">${'★'.repeat(p.difficulty)}</span>
          <span>约 ${p.hours} 小时</span>
          <span>阶段 ${p.stage}</span>
        </div>
        <div class="tags stack">${(p.stack || []).map((s) => `<span>${esc(s)}</span>`).join('<span>·</span>')}</div>
        ${payoff ? `<div class="value">省下：${esc(payoff)}</div>` : ''}
        ${refs ? `<div class="refs-line"><span class="refs-label">教程</span>${refs}</div>` : ''}
        ${
          p.steps?.length
            ? `<details><summary>怎么做</summary><ol>${p.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details>`
            : ''
        }
      </article>`
    })
    .join('')
}

export function render() {
  renderDiscoveries()
  renderProjects()
}
