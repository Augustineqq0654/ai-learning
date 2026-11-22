/* 装配层：加载数据 → 调当前页的 render() → 绑「更新」与过期自动更新。 */

import { $, data, getJson, loadState, state, toast, touchStreak } from './core.js'
import * as newsPage from './pages/news.js'
import * as studyPage from './pages/study.js'
import * as projectsPage from './pages/projects.js'
import * as tutorialsPage from './pages/tutorials.js'
import * as modelsPage from './pages/models.js'
import * as promptsPage from './pages/prompts.js'
import * as recordsPage from './pages/records.js'

const PAGES = {
  news: newsPage,
  study: studyPage,
  projects: projectsPage,
  tutorials: tutorialsPage,
  models: modelsPage,
  prompts: promptsPage,
  records: recordsPage,
}

const STALE_NEWS_MS = 6 * 3600 * 1000
const STALE_MODELS_MS = 24 * 3600 * 1000

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

/** 抓取完成后只刷新会被新数据影响的区块；当前页之外的 render 会被各自的空元素判断挡掉。 */
function refreshViews() {
  newsPage.render()
  projectsPage.render()
  modelsPage.render()
}

function isStale(page) {
  const now = Date.now()
  if (page === 'news' || page === 'projects') {
    return !data.news?.fetchedAt || now - Date.parse(data.news.fetchedAt) > STALE_NEWS_MS
  }
  if (page === 'models') {
    const stamp = data.models?.updatedAt ? Date.parse(`${data.models.updatedAt}T00:00:00`) : 0
    return !stamp || now - stamp > STALE_MODELS_MS
  }
  return false
}

/** 打开页面时如果数据过期，静默跑一次抓取；失败就当作没发生 */
async function autoRefresh(page) {
  if (!isStale(page)) return

  const btn = $('#refresh')
  const label = btn?.textContent
  if (btn) {
    btn.disabled = true
    btn.textContent = '更新中…'
  }

  try {
    const res = await fetch('/api/refresh', { method: 'POST' })
    const payload = await res.json()
    if (payload.running || !payload.ok) return

    data.news = await getJson('/api/news').catch(() => data.news)
    data.models = await getJson('/data/models.json').catch(() => data.models)
    refreshViews()
    toast('数据已自动更新')
  } catch {
    /* 后台更新失败不打扰用户 */
  } finally {
    if (btn) {
      btn.disabled = false
      btn.textContent = label || '更新'
    }
  }
}

function bindRefresh() {
  const btn = $('#refresh')
  if (!btn) return
  btn.addEventListener('click', async () => {
    btn.disabled = true
    btn.textContent = '更新中…'
    try {
      const res = await fetch('/api/refresh', { method: 'POST' })
      const payload = await res.json()
      if (payload.running) {
        toast('已经有一次更新在进行中')
        return
      }
      if (!payload.ok) throw new Error(payload.error || '抓取失败')
      data.news = await getJson('/api/news')
      data.models = await getJson('/data/models.json').catch(() => data.models)
      refreshViews()
      toast(`已更新 · ${data.news.items?.length || 0} 条新闻`)
    } catch (err) {
      toast(`更新失败：${err.message}`)
    } finally {
      btn.disabled = false
      btn.textContent = '更新'
    }
  })
}

async function boot() {
  Object.assign(state, loadState())

  const [n, r, p, t, m, q] = await Promise.allSettled([
    getJson('/api/news'),
    getJson('/data/roadmap.json'),
    getJson('/data/projects.json'),
    getJson('/data/tutorials.json'),
    getJson('/data/models.json'),
    getJson('/data/prompts.json'),
  ])

  data.news = n.status === 'fulfilled' ? n.value : null
  data.roadmap = r.status === 'fulfilled' ? r.value : null
  data.projects = p.status === 'fulfilled' ? p.value : null
  data.tutorials = t.status === 'fulfilled' ? t.value : null
  data.models = m.status === 'fulfilled' ? m.value : null
  data.prompts = q.status === 'fulfilled' ? q.value : null

  // 没手动选过阶段时，跟随 roadmap 的当前阶段；手动选过就不再覆盖
  if (data.roadmap?.currentStage != null && !state.stagePinned) state.stage = data.roadmap.currentStage

  touchStreak()
  renderStreak()

  const page = document.body.dataset.page
  PAGES[page]?.render()

  bindRefresh()
  autoRefresh(page)
}

boot().catch((err) => {
  const el = $('#meta')
  if (el) el.textContent = `加载失败：${err.message}`
})
