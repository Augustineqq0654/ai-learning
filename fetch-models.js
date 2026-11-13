/**
 * fetch-models.js
 * 只更新能从公开源拿到的部分：
 *   1. 价格 / 上下文  ← OpenRouter /api/v1/models（自动）
 *   2. 用量榜名次与前 10 名 ← openrouter.ai/rankings 的 JSON-LD（自动）
 *
 * 人工维护的部分（场景推荐、额度、用途说明、结论、省钱技巧）一律不动。
 * 网络失败时保持原文件，只记录 lastAttemptAt，不写假数据。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDispatcher, fetchJson, fetchText } from './lib/net.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.join(ROOT, 'data', 'models.json')

const MODELS_API = 'https://openrouter.ai/api/v1/models'
const RANKINGS_URL = 'https://openrouter.ai/rankings'

let dispatcher = undefined

const VENDORS = {
  deepseek: 'DeepSeek',
  tencent: '腾讯',
  'z-ai': 'Z.ai',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  stepfun: 'StepFun',
  minimax: 'MiniMax',
  moonshotai: 'Moonshot',
  google: 'Google',
  'x-ai': 'xAI',
  'meta-llama': 'Meta',
  mistralai: 'Mistral',
  alibaba: '阿里',
  qwen: 'Qwen',
  baidu: '百度',
  bytedance: '字节',
  'thudm': '智谱',
}

const today = () => new Date().toISOString().slice(0, 10)

/** 归一化模型名：去掉「厂商: 」前缀和所有标点，只留小写字母数字 */
function normName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^[^:]{1,24}:\s*/, '')
    .replace(/[^a-z0-9.]+/g, '')
}

function vendorOf(orId, fallback) {
  const prefix = String(orId || '').split('/')[0]
  return VENDORS[prefix] || fallback || prefix || '—'
}

/** OpenRouter 的 pricing 是「每 token 美元」，换算成每百万 token */
function formatPrice(pricing) {
  const prompt = Number(pricing?.prompt) * 1e6
  const completion = Number(pricing?.completion) * 1e6
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return null
  if (prompt === 0 && completion === 0) return '免费'
  const fmt = (v) => (v >= 0.01 ? v.toFixed(2) : v.toFixed(4))
  return `$${fmt(prompt)} / $${fmt(completion)}`
}

function parseRanking(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1])

  for (const raw of blocks) {
    let data
    try {
      data = JSON.parse(raw)
    } catch {
      continue
    }
    const list = Array.isArray(data) ? data : [data]
    for (const node of list) {
      if (node?.['@type'] === 'ItemList' && Array.isArray(node.itemListElement)) {
        const rows = node.itemListElement
          .map((el) => {
            const id = String(el.item || '').replace(/^https?:\/\/openrouter\.ai\//, '')
            return { rank: Number(el.position), name: String(el.name || '').trim(), orId: id || null }
          })
          .filter((r) => r.name && Number.isFinite(r.rank))
          .sort((a, b) => a.rank - b.rank)
        if (rows.length >= 5) return { rows, updated: dateModified(html) }
      }
    }
  }
  return null
}

function dateModified(html) {
  const m = html.match(/dateModified\\?":\\?"([0-9]{4}-[0-9]{2}-[0-9]{2})/)
  return m ? m[1] : null
}

async function main() {
  const raw = await fs.readFile(FILE, 'utf8')
  const data = JSON.parse(raw)
  const snapshot = fingerprint(data)
  const net = createDispatcher()
  dispatcher = net.dispatcher
  console.log(net.proxy ? `[models] 走代理 ${net.proxy}` : '[models] 直连（未检测到代理）')

  /* ---------------------------- 1. 价格 ---------------------------- */
  let priceOk = false
  let matched = 0
  const missed = []

  try {
    const payload = await fetchJson(MODELS_API, { dispatcher: net.dispatcher, timeoutMs: 20000 })
    const list = payload?.data || []
    const byId = new Map(list.map((m) => [m.id, m]))
    const byName = new Map()
    for (const m of list) {
      const key = normName(m.name)
      if (!byName.has(key)) byName.set(key, [])
      byName.get(key).push(m)
    }

    for (const model of data.goModels || []) {
      let hit = model.orId ? byId.get(model.orId) : null
      if (!hit) {
        const cands = byName.get(normName(model.name)) || []
        // 只有唯一同名才敢用，避免把 Flash 和 FlashX 弄混
        if (cands.length === 1) hit = cands[0]
      }
      if (!hit) {
        missed.push(model.name)
        continue
      }
      const price = formatPrice(hit.pricing)
      if (!price) {
        missed.push(model.name)
        continue
      }
      model.orId = hit.id
      model.price = price
      model.priceSource = 'OpenRouter'
      if (hit.context_length) model.ctx = hit.context_length
      matched++
    }

    data.priceUpdatedAt = today()
    data.priceMatched = matched
    data.priceMissed = missed
    priceOk = true
    console.log(`[models] 价格：${matched} 个匹配，${missed.length} 个未匹配`)
    if (missed.length) console.log(`[models]   未匹配：${missed.join('、')}`)
  } catch (err) {
    console.log(`[models] 价格更新失败：${err.message}（保留原值）`)
  }

  /* ---------------------------- 2. 用量榜 ---------------------------- */
  try {
    const html = await fetchText(RANKINGS_URL, { dispatcher: net.dispatcher, timeoutMs: 20000 })
    const ranking = parseRanking(html)

    if (!ranking) throw new Error('没解析出榜单结构')

    const old = data.market || []
    const oldByName = new Map(old.map((r) => [normName(r.name), r]))
    const oldById = new Map(old.filter((r) => r.orId).map((r) => [r.orId, r]))

    data.market = ranking.rows.map((row) => {
      const prev = oldById.get(row.orId) || oldByName.get(normName(row.name)) || {}
      return {
        rank: row.rank,
        name: row.name,
        vendor: vendorOf(row.orId, prev.vendor),
        orId: row.orId,
        weekly: prev.weekly ?? null,
        share: prev.share ?? null,
        best: prev.best || '',
      }
    })
    data.rankUpdatedAt = today()
    data.rankThrough = ranking.updated || today()

    const missingNumbers = data.market.filter((r) => !r.weekly).length
    console.log(`[models] 用量榜：前 ${data.market.length} 名已更新，截至 ${data.rankThrough}`)
    if (missingNumbers) console.log(`[models]   其中 ${missingNumbers} 个新上榜模型缺少用量数字（需人工补）`)
  } catch (err) {
    console.log(`[models] 用量榜更新失败：${err.message}（保留原榜单）`)
  }

  /* ---------------------------- 3. 落盘 ---------------------------- */
  if (!priceOk && !data.rankUpdatedAt) {
    console.log('[models] 两个源都没拿到，保持原文件不动')
    return
  }

  data.lastAttemptAt = new Date().toISOString()
  data.updatedAt = today()
  data.note =
    '用量榜名次来自 OpenRouter 周榜（自动更新），价格为 OpenRouter 挂牌价 USD/百万 token（自动更新）；' +
    '额度、场景推荐、用途说明为人工维护。用量数字为上次人工核对值，新上榜模型会显示 —。'

  // 没有实质变化就不落盘，避免每次自动刷新都把工作区弄脏
  if (fingerprint(data) === snapshot) {
    console.log('[models] 无变化，跳过写入')
    return
  }

  await fs.writeFile(FILE, JSON.stringify(data, null, 2), 'utf8')
  console.log('[models] 已写入 data/models.json')
}

function fingerprint(data) {
  const { lastAttemptAt, ...rest } = data
  return JSON.stringify(rest)
}

main()
  .catch((err) => {
    console.error('[models] 失败：', err)
    process.exitCode = 1
  })
  .finally(async () => {
    if (dispatcher?.close) await dispatcher.close()
  })
