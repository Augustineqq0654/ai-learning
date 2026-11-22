/* 公共层：DOM 小工具、本地状态、五个数据文件的落点。
   页面自己的渲染逻辑在 pages/*.js，装配在 boot.js。 */

export const CATEGORIES = [
  { id: 'product', label: '产品与工具' },
  { id: 'method', label: '技术方法' },
  { id: 'resource', label: '教程与资源' },
  { id: 'industry', label: '行业动态' },
]

export const $ = (sel) => document.querySelector(sel)

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function pad(n) {
  return String(n).padStart(2, '0')
}

export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function timeAgo(iso) {
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
export function toast(message) {
  const el = $('#toast')
  if (!el) return
  el.textContent = message
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    el.hidden = true
  }, 2200)
}

/* --------------------------------- 本地状态 -------------------------------- */

const KEY = 'ai-learning-state-v1'

export const state = {
  completed: [],
  skipped: {},
  stage: null,
  stagePinned: false,
  streak: { days: 0, lastActive: null },
}

export function loadState() {
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

export function saveState() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function touchStreak() {
  const today = dayKey()
  if (state.streak.lastActive === today) return
  const yesterday = dayKey(new Date(Date.now() - 86400000))
  state.streak.days = state.streak.lastActive === yesterday ? (state.streak.days || 0) + 1 : 1
  state.streak.lastActive = today
  saveState()
}

/* --------------------------------- 数据容器 -------------------------------- */

export async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** boot() 填充；页面只读，不自己写。 */
export const data = {
  news: null,
  roadmap: null,
  projects: null,
  tutorials: null,
  models: null,
  prompts: null,
}
