/* 学习页：阶段切换、阶段卡片、今日任务（含前后翻看与完成/跳过）。 */

import { $, data, dayKey, esc, saveState, state, toast } from '../core.js'

/** 当前正在看的任务下标；切阶段时重置 */
let taskCursor = null

function stageList() {
  return data.roadmap?.stages || []
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

/** 默认定位到第一个没做完、今天也没跳过的任务 */
function defaultTaskIndex(stage) {
  const tasks = stage.tasks || []
  const today = dayKey()
  const i = tasks.findIndex((t) => !state.completed.includes(t.id) && state.skipped[t.id] !== today)
  return i === -1 ? Math.max(0, tasks.length - 1) : i
}

function fmtMinutes(minutes) {
  if (minutes >= 60) return `${(minutes / 60).toFixed(minutes % 60 ? 1 : 0)} 小时`
  return `${minutes} 分钟`
}

function renderTask() {
  const box = $('#task-card')
  const hint = $('#task-hint')
  if (!box) return

  const stage = currentStage()
  const tasks = stage?.tasks || []

  if (!stage || !tasks.length) {
    box.innerHTML = `<div class="empty">还在写学习路径。</div>`
    if (hint) hint.textContent = ''
    return
  }

  if (!taskCursor || taskCursor.stageId !== stage.id || taskCursor.index >= tasks.length) {
    taskCursor = { stageId: stage.id, index: defaultTaskIndex(stage) }
  }

  const index = taskCursor.index
  const task = tasks[index]
  const finished = state.completed.includes(task.id)
  const skipped = state.skipped[task.id] === dayKey()
  const doneCount = tasks.filter((t) => state.completed.includes(t.id)).length

  if (hint) {
    hint.textContent =
      doneCount === tasks.length
        ? `阶段 ${stage.id} 已完成 · ${doneCount}/${tasks.length}`
        : `阶段 ${stage.id} 进度 ${doneCount}/${tasks.length}`
  }

  const refs = (task.refs || [])
    .map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noreferrer noopener">${esc(r.label)}</a>`)
    .join('')

  box.innerHTML = `
    <div class="task">
      <div class="task-head">
        <div class="task-pos">
          <span class="task-id">任务 ${esc(task.id)}</span>
          ${finished ? '<span class="task-badge is-done">已完成</span>' : ''}
          ${skipped && !finished ? '<span class="task-badge is-skip">今天已跳过</span>' : ''}
        </div>
        <div class="task-nav">
          <button class="icon-btn" id="task-prev" title="上一个任务" ${index === 0 ? 'disabled' : ''}>‹</button>
          <span class="task-count">${index + 1} / ${tasks.length}</span>
          <button class="icon-btn" id="task-next" title="下一个任务" ${index === tasks.length - 1 ? 'disabled' : ''}>›</button>
        </div>
      </div>
      <h3 class="task-title">${esc(task.title)}</h3>
      <div class="task-facts">
        <span>约 <b>${fmtMinutes(task.minutes)}</b></span>
        <span>交付物：<b>${esc(task.deliverable)}</b></span>
      </div>
      ${refs ? `<div class="task-refs">${refs}</div>` : ''}
      <div class="task-actions">
        ${finished ? '<button class="btn" id="task-undo">撤销完成</button>' : '<button class="btn btn-primary" id="task-done-btn">完成</button>'}
        ${
          finished
            ? ''
            : skipped
              ? '<button class="btn" id="task-unskip">取消跳过</button>'
              : '<button class="btn" id="task-skip-btn">今天跳过</button>'
        }
      </div>
    </div>`

  $('#task-prev')?.addEventListener('click', () => {
    if (taskCursor.index > 0) {
      taskCursor.index -= 1
      renderTask()
    }
  })

  $('#task-next')?.addEventListener('click', () => {
    if (taskCursor.index < tasks.length - 1) {
      taskCursor.index += 1
      renderTask()
    }
  })

  $('#task-done-btn')?.addEventListener('click', () => {
    state.completed.push(task.id)
    delete state.skipped[task.id]
    saveState()
    taskCursor.index = Math.min(index + 1, tasks.length - 1)
    renderStage()
    renderTask()
    toast(`完成 ${task.id} · 保持住`)
  })

  $('#task-undo')?.addEventListener('click', () => {
    state.completed = state.completed.filter((id) => id !== task.id)
    saveState()
    renderStage()
    renderTask()
    toast(`已撤销 ${task.id}`)
  })

  $('#task-skip-btn')?.addEventListener('click', () => {
    state.skipped[task.id] = dayKey()
    saveState()
    taskCursor.index = Math.min(index + 1, tasks.length - 1)
    renderTask()
    toast('已跳过，明天还会出现')
  })

  $('#task-unskip')?.addEventListener('click', () => {
    delete state.skipped[task.id]
    saveState()
    renderTask()
    toast('已取消跳过')
  })
}

export function render() {
  renderStageSwitch()
  renderStage()
  renderTask()
}
