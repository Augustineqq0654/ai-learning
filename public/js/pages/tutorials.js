/* 教程页：按学习阶段分组的常驻教程清单。 */

import { $, data, esc } from '../core.js'

function tutorialCard(t) {
  return `
    <a class="tutorial" href="${esc(t.url)}" target="_blank" rel="noreferrer noopener">
      <div class="tut-top">
        <span class="tut-title">${esc(t.title)}</span>
        <span class="tut-meta">${esc(t.source || '')} · ${esc(t.level)}</span>
      </div>
      <p class="tut-desc">${esc(t.desc)}</p>
    </a>`
}

function renderTutorials() {
  const box = $('#tutorial-list')
  if (!box) return

  const all = (data.tutorials?.tutorials || []).slice().sort((a, b) => a.stage - b.stage)

  if (!all.length) {
    box.innerHTML = `<div class="empty">还没有教程条目。</div>`
    return
  }

  const groups = new Map()
  for (const t of all) {
    if (!groups.has(t.stage)) groups.set(t.stage, [])
    groups.get(t.stage).push(t)
  }

  const stageName = (id) => (data.roadmap?.stages || []).find((s) => s.id === id)?.name || ''

  box.innerHTML = [...groups.entries()]
    .map(
      ([stage, list]) => `
      <section class="tut-group">
        <h2 class="tut-group-title">阶段 ${stage}${stageName(stage) ? ` · ${esc(stageName(stage))}` : ''}<span>${list.length} 个</span></h2>
        <div class="tutorials">${list.map(tutorialCard).join('')}</div>
      </section>`
    )
    .join('')
}

export function render() {
  renderTutorials()
}
