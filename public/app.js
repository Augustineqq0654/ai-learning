/* AI 学习驾驶舱 · 前端逻辑（无框架，无构建） */

const KEY = 'ai-learning-state-v1'

const CATEGORIES = [
  { id: 'product', label: '产品与工具' },
  { id: 'method', label: '技术方法' },
  { id: 'resource', label: '教程与资源' },
  { id: 'industry', label: '行业动态' },
]

const $ = (sel) => document.querySelector(sel)

const state = {
  completed: [],
  skipped: {},
  stage: null,
  stagePinned: false,
  streak: { days: 0, lastActive: null },
}

let news = null
let roadmap = null
let projects = null
let tutorials = null
let models = null

let newsFilter = 'all'
let projectFilter = 'all'
let sceneFilter = 'all'

/* --------------------------------- 工具 ---------------------------------- */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function pad(n) {
  return String(n).padStart(2, '0')
}

function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return ''
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  return `${Math.floor(hour / 24)} 天前`
}

let toastTimer = null
function toast(message) {
  const el = $('#toast')
  el.textContent = message
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    el.hidden = true
  }, 2200)
}

/* --------------------------------- 状态 ---------------------------------- */

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}')
    return {
      completed: Array.isArray(saved.completed) ? saved.completed : [],
      skipped: saved.skipped || {},
      stage: saved.stage ?? null,
      stagePinned: saved.stagePinned === true,
      streak: { days: 0, lastActive: null, ...(saved.streak || {}) },
    }
  } catch {
    return { completed: [], skipped: {}, stage: null, stagePinned: false, streak: { days: 0, lastActive: null } }
  }
}

function saveState() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* 隐私模式下忽略 */
  }
}

function touchStreak() {
  const today = dayKey()
  if (state.streak.lastActive === today) return
  const yesterday = dayKey(new Date(Date.now() - 86400000))
  state.streak.days = state.streak.lastActive === yesterday ? (state.streak.days || 0) + 1 : 1
  state.streak.lastActive = today
  saveState()
}

/* --------------------------------- 加载 ---------------------------------- */

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function boot() {
  Object.assign(state, loadState())

  const [n, r, p, t, m] = await Promise.allSettled([
    getJson('/api/news'),
    getJson('/data/roadmap.json'),
    getJson('/data/projects.json'),
    getJson('/data/tutorials.json'),
    getJson('/data/models.json'),
  ])

  news = n.status === 'fulfilled' ? n.value : null
  roadmap = r.status === 'fulfilled' ? r.value : null
  projects = p.status === 'fulfilled' ? p.value : null
  tutorials = t.status === 'fulfilled' ? t.value : null
  models = m.status === 'fulfilled' ? m.value : null

  // 没手动选过阶段时，跟随 roadmap 的当前阶段；手动选过就不再覆盖
  if (roadmap?.currentStage != null && !state.stagePinned) state.stage = roadmap.currentStage

  touchStreak()
  renderStreak()

  const page = document.body.dataset.page

  if (page === 'news') {
    renderMeta()
    renderNewsFilters()
    renderNews()
  } else if (page === 'study') {
    renderStageSwitch()
    renderStage()
    renderTask()
  } else if (page === 'projects') {
    renderDiscoveries()
    renderProjects()
  } else if (page === 'tutorials') {
    renderTutorials()
  } else if (page === 'models') {
    renderModels()
  }

  bindRefresh()
}

/* --------------------------------- 顶部 ---------------------------------- */

function renderStreak() {
  const el = $('#streak')
  if (!el) return
  if (!state.streak.days) {
    el.hidden = true
    return
  }
  el.hidden = false
  el.textContent = `连续学习 ${state.streak.days} 天`
}

function renderMeta() {
  const el = $('#meta')
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

/* --------------------------------- 新闻 ---------------------------------- */

function renderNewsFilters() {
  const box = $('#filters')
  if (!box) return
  const items = news?.items || []
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

/* --------------------------------- 阶段 ---------------------------------- */

function stageList() {
  return roadmap?.stages || []
}

function currentStage() {
  const list = stageList()
  return list.find((s) => s.id === state.stage) || list[0] || null
}

function renderStageSwitch() {
  const box = $('#stage-switch')
  if (!box) return
  const list = stageList()
  if (!list.length) {
    box.innerHTML = ''
    return
  }
  box.innerHTML = list
    .map(
      (s) =>
        `<button class="stage-btn ${s.id === state.stage ? 'on' : ''} ${s.done ? 'done' : ''}" data-stage="${s.id}">${s.id}</button>`
    )
    .join('')

  box.querySelectorAll('.stage-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.stage = Number(btn.dataset.stage)
      state.stagePinned = true
      saveState()
      renderStageSwitch()
      renderStage()
      renderTask()
      renderProjects()
    })
  })
}

function renderStage() {
  const box = $('#stage-card')
  if (!box) return
  const stage = currentStage()

  if (!stage) {
    box.innerHTML = `<div class="empty">还在写学习路径。</div>`
    return
  }

  const total = stage.tasks?.length || 0
  const done = (stage.tasks || []).filter((t) => state.completed.includes(t.id)).length
  const pct = total ? Math.round((done / total) * 100) : 0

  box.innerHTML = `
    <div class="stage-title">
      <h3>${esc(stage.name)}</h3>
      <span class="stage-index">阶段 ${stage.id} / ${stageList().length}</span>
    </div>
    <p class="stage-headline">${esc(stage.headline)}</p>
    <p class="stage-goal">${esc(stage.goal)}</p>
    <div class="concepts">${(stage.concepts || []).map((c) => `<span class="concept">${esc(c)}</span>`).join('')}</div>
    <div class="pass"><b>过关标准</b>　${esc(stage.passCriteria)}</div>
    <div class="progress">
      <div class="bar"><span style="width:${pct}%"></span></div>
      <span class="progress-label">${done}/${total}</span>
    </div>`
}

/* --------------------------------- 任务 ---------------------------------- */

function nextTask(stage) {
  const today = dayKey()
  return (stage.tasks || []).find((t) => !state.completed.includes(t.id) && state.skipped[t.id] !== today) || null
}

function renderTask() {
  const box = $('#task-card')
  const hint = $('#task-hint')
  if (!box) return
  const stage = currentStage()

  if (!stage) {
    box.innerHTML = `<div class="empty">还在写学习路径。</div>`
    if (hint) hint.textContent = ''
    return
  }

  const task = nextTask(stage)
  const total = stage.tasks?.length || 0
  const done = (stage.tasks || []).filter((t) => state.completed.includes(t.id)).length
  if (hint) hint.textContent = `阶段 ${stage.id} 进度 ${done}/${total}`

  if (!task) {
    const next = stageList().find((s) => s.id > stage.id)
    box.innerHTML = `
      <div class="task-done">
        <span class="big">✓</span>
        <span>这个阶段的 ${total} 个任务都做完了。${next ? `下一步进入「${esc(next.name)}」。` : '五个阶段都走完了，去做那个一直想做的项目吧。'}</span>
      </div>`
    return
  }

  const refs = (task.refs || [])
    .map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noreferrer noopener">${esc(r.label)}</a>`)
    .join('')

  box.innerHTML = `
    <div class="task">
      <div class="task-id">任务 ${esc(task.id)}</div>
      <h3 class="task-title">${esc(task.title)}</h3>
      <div class="task-facts">
        <span>约 <b>${task.minutes >= 60 ? `${(task.minutes / 60).toFixed(task.minutes % 60 ? 1 : 0)} 小时` : `${task.minutes} 分钟`}</b></span>
        <span>交付物：<b>${esc(task.deliverable)}</b></span>
      </div>
      ${refs ? `<div class="task-refs">${refs}</div>` : ''}
      <div class="task-actions">
        <button class="btn btn-primary" id="task-done-btn">完成</button>
        <button class="btn" id="task-skip-btn">今天跳过</button>
      </div>
    </div>`

  $('#task-done-btn')?.addEventListener('click', () => {
    state.completed.push(task.id)
    saveState()
    renderStage()
    renderTask()
    toast(`完成 ${task.id} · 保持住`)
  })

  $('#task-skip-btn')?.addEventListener('click', () => {
    state.skipped[task.id] = dayKey()
    saveState()
    renderTask()
    toast('已跳过，明天还会出现')
  })
}

/* --------------------------------- 项目 ---------------------------------- */

function renderDiscoveries() {
  const block = $('#discoveries-block')
  const box = $('#discoveries')
  if (!block || !box) return
  const list = news?.discoveries || []

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

  const all = (tutorials?.tutorials || []).slice().sort((a, b) => a.stage - b.stage)

  if (!all.length) {
    box.innerHTML = `<div class="empty">还没有教程条目。</div>`
    return
  }

  const groups = new Map()
  for (const t of all) {
    if (!groups.has(t.stage)) groups.set(t.stage, [])
    groups.get(t.stage).push(t)
  }

  const stageName = (id) => (roadmap?.stages || []).find((s) => s.id === id)?.name || ''

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

function renderProjects() {
  const box = $('#project-list')
  const filterBox = $('#project-filters')
  if (!box || !filterBox) return

  const all = projects?.projects || []

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

/* --------------------------------- 选型 ---------------------------------- */

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
        <span class="chip scene-tag">${esc(s.groupLabel)}</span>
      </div>
      <div class="pick"><span class="pick-label">首选</span><b>${esc(s.primary.model)}</b><span class="pick-why">${esc(s.primary.why)}</span></div>
      ${alt}
      <p class="scene-tip">${esc(s.tip)}</p>
    </article>`
}

function renderSceneFilters() {
  const box = $('#scene-filters')
  if (!box) return

  const present = new Set((models?.scenarios || []).map((s) => s.group))
  const chips = (models?.groups || []).filter((g) => g.id === 'all' || present.has(g.id))

  box.innerHTML = chips
    .map((g) => `<button class="filter ${sceneFilter === g.id ? 'on' : ''}" data-group="${g.id}">${g.label}</button>`)
    .join('')

  box.querySelectorAll('.filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      sceneFilter = btn.dataset.group
      renderSceneFilters()
      renderScenes()
    })
  })
}

function renderScenes() {
  const box = $('#scene-list')
  if (!box) return

  const all = models?.scenarios || []
  if (!all.length) {
    box.innerHTML = `<div class="empty">选型数据还没生成。检查 data/models.json。</div>`
    return
  }

  const list = all.filter((s) => sceneFilter === 'all' || s.group === sceneFilter)
  box.innerHTML = list.map(sceneCard).join('')
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
  const meta = $('#models-meta')
  if (meta) {
    meta.textContent = models
      ? `数据截至 ${models.statsThrough} · ${models.scenarios.length} 个场景 · Go 订阅 ${models.goModels.length} 个模型`
      : '选型数据没加载出来'
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

  renderSceneFilters()
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
      <thead><tr><th>#</th><th>模型</th><th>周用量</th><th>占前十</th><th>大家拿它干什么</th></tr></thead>
      <tbody>${(models.market || [])
        .map(
          (m) => `
        <tr>
          <td class="rank">${m.rank}</td>
          <td class="model-name">${esc(m.name)}<span class="vendor">${esc(m.vendor)}</span></td>
          <td class="mono">${esc(m.weekly)}</td>
          <td class="share"><span class="share-bar"><span style="width:${m.share}%"></span></span><span class="share-num">${m.share}%</span></td>
          <td>${esc(m.best)}</td>
        </tr>`
        )
        .join('')}</tbody>`
  }

  const tips = $('#tips-list')
  if (tips && models) {
    tips.innerHTML = (models.tips || []).map((t) => `<li>${esc(t)}</li>`).join('')
  }
}

/* --------------------------------- 更新 ---------------------------------- */

function bindRefresh() {
  const btn = $('#refresh')
  if (!btn) return
  btn.addEventListener('click', async () => {
    btn.disabled = true
    btn.textContent = '更新中…'
    try {
      const res = await fetch('/api/refresh', { method: 'POST' })
      const data = await res.json()
      if (data.running) {
        toast('已经有一次更新在进行中')
        return
      }
      if (!data.ok) throw new Error(data.error || '抓取失败')
      news = await getJson('/api/news')
      renderMeta()
      renderNewsFilters()
      renderNews()
      renderDiscoveries()
      toast(`已更新 · ${news.items?.length || 0} 条`)
    } catch (err) {
      toast(`更新失败：${err.message}`)
    } finally {
      btn.disabled = false
      btn.textContent = '更新'
    }
  })
}

boot().catch((err) => {
  const el = $('#meta')
  if (el) el.textContent = `加载失败：${err.message}`
})
