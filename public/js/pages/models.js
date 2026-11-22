/* 选型页：五个场景、OpenCode Go 模型表、市面用量 Top 10、省钱三条。 */

import { $, data, esc } from '../core.js'

const GO_HEAD = `<thead><tr>
  <th>级别</th><th>模型</th><th>价格 / 1M</th><th>月额度</th><th>最适合</th><th>备注</th>
</tr></thead>`

function sceneCard(s) {
  const alt = s.alternative
    ? `<div class="pick"><span class="pick-label alt">备选</span><b>${esc(s.alternative.model)}</b><span class="pick-why">${esc(s.alternative.why)}</span></div>`
    : ''

  return `
    <article class="scene">
      <div class="scene-head">
        <h3>${esc(s.name)}</h3>
        <span class="scene-desc">${esc(s.desc)}</span>
      </div>
      <div class="pick"><span class="pick-label">首选</span><b>${esc(s.primary.model)}</b><span class="pick-why">${esc(s.primary.why)}</span></div>
      ${alt}
      <p class="scene-tip">${esc(s.tip)}</p>
    </article>`
}

function renderScenes() {
  const box = $('#scene-list')
  if (!box) return

  const all = data.models?.scenarios || []
  if (!all.length) {
    box.innerHTML = `<div class="empty">选型数据还没生成。检查 data/models.json。</div>`
    return
  }

  box.innerHTML = all.map(sceneCard).join('')

  const extras = $('#scene-extras')
  if (extras) {
    const list = data.models?.extras || []
    extras.innerHTML = list
      .map((e) => `<span class="extra"><span class="extra-label">${esc(e.label)}</span><b>${esc(e.model)}</b></span>`)
      .join('')
    extras.hidden = !list.length
  }
}

function goRows(list) {
  return list
    .map(
      (m) => `
      <tr>
        <td><span class="tier tier-${m.tier.toLowerCase()}">${m.tier}</span></td>
        <td class="model-name">${esc(m.name)}</td>
        <td class="mono">${esc(m.price)}</td>
        <td class="mono quota">${esc(m.quota)}</td>
        <td>${esc(m.best)}</td>
        <td class="muted-cell">${esc(m.note)}</td>
      </tr>`
    )
    .join('')
}

function renderModels() {
  const models = data.models

  const meta = $('#models-meta')
  if (meta) {
    if (!models) {
      meta.textContent = '选型数据没加载出来'
    } else {
      const parts = []
      if (models.priceUpdatedAt) parts.push(`价格自动更新于 ${models.priceUpdatedAt}`)
      if (models.rankThrough) parts.push(`用量榜截至 ${models.rankThrough}`)
      parts.push(`${models.scenarios.length} 个场景`, `Go ${models.goModels.length} 个模型`)
      meta.textContent = parts.join(' · ')
    }
  }

  const note = $('#models-note')
  if (note) {
    const lines = models?.conclusion || []
    note.hidden = !lines.length
    note.innerHTML = lines
      .map((line, i) => `<div class="conclusion"><span class="conclusion-idx">${i + 1}</span><span>${esc(line)}</span></div>`)
      .join('')
  }

  if (models?.note) {
    const source = $('#models-source')
    if (source) source.textContent = models.note
  }

  const marketHint = $('#market-hint')
  if (marketHint && models?.rankThrough) marketHint.textContent = `OpenRouter 周榜 · 截至 ${models.rankThrough} · 名次每天自动更新`

  const goHint = $('#go-hint')
  if (goHint) {
    const missed = models?.priceMissed || []
    goHint.textContent = !models
      ? ''
      : missed.length
        ? `${models.priceMatched} 个模型的价格已跟 OpenRouter 对齐；${missed.length} 个没匹配到条目，价格保留人工填写：${missed.join('、')}`
        : '价格已全部跟 OpenRouter 对齐。'
  }

  renderScenes()

  const goTable = $('#go-table')
  if (goTable && models) {
    const main = models.goModels.filter((m) => m.tier !== 'B')
    const rest = models.goModels.filter((m) => m.tier === 'B')

    goTable.innerHTML = `${GO_HEAD}<tbody>${goRows(main)}</tbody>`

    const more = $('#go-more')
    const tableB = $('#go-table-b')
    if (more) {
      more.hidden = !rest.length
      const summary = more.querySelector('summary')
      if (summary) summary.textContent = `B 级 / 专项与免费额度（${rest.length} 个）`
    }
    if (tableB) tableB.innerHTML = `${GO_HEAD}<tbody>${goRows(rest)}</tbody>`
  }

  const marketTable = $('#market-table')
  if (marketTable && models) {
    marketTable.innerHTML = `
      <thead><tr><th>#</th><th>模型</th><th>厂商</th><th>大家拿它干什么</th></tr></thead>
      <tbody>${(models.market || [])
        .map(
          (m) => `
        <tr>
          <td class="rank">${m.rank}</td>
          <td class="model-name">${esc(m.name)}</td>
          <td class="muted-cell">${esc(m.vendor)}</td>
          <td>${esc(m.best || '—')}</td>
        </tr>`
        )
        .join('')}</tbody>`
  }

  const tips = $('#tips-list')
  if (tips && models) {
    tips.innerHTML = (models.tips || []).map((t) => `<li>${esc(t)}</li>`).join('')
  }
}

export function render() {
  renderModels()
}
