/**
 * fetch-data.js
 * 抓取 → 规范化 → 去重 → 分类 → 打分 → 写 data/news.json
 *
 * 网络层统一走 lib/net.js（代理发现、超时、重试）。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createDispatcher, fetchText } from './lib/net.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(ROOT, 'data')

/** 全局 dispatcher：有代理走代理，没代理直连 */
let dispatcher = undefined

/* ---------------------------------- 抓取 --------------------------------- */

const get = (url, timeoutMs, retries = 1) => fetchText(url, { dispatcher, timeoutMs, retries })
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= list.length) return
      out[i] = await fn(list[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

/* -------------------------------- 文本工具 -------------------------------- */

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
}

function safeCodePoint(n) {
  try {
    return String.fromCodePoint(n)
  } catch {
    return ''
  }
}

const stripTags = (s) => s.replace(/<[^>]*>/g, ' ')

function clean(s = '') {
  // 顺序很重要：先解 CDATA / 实体，再剥标签。反过来的话 <![CDATA[...]]> 会被整段当成标签吃掉。
  return stripTags(decodeEntities(String(s))).replace(/\s+/g, ' ').trim()
}

function firstSentence(text, max = 80) {
  if (!text) return ''
  const cut = text.split(/(?<=[。！？!?；;])/)[0] || text
  const s = cut.length > max ? cut.slice(0, max) + '…' : cut
  return s.trim()
}

function parseTime(value) {
  if (!value) return null
  const t = Date.parse(String(value).replace(/\s+/g, ' ').trim())
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/** '11-08 01:37' → ISO（跨年时自动回退一年） */
function parseCnTime(mmddhhmm) {
  const m = String(mmddhhmm).match(/(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/)
  if (!m) return null
  const now = new Date()
  const d = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]), Number(m[3]), Number(m[4]))
  if (d.getTime() > now.getTime() + 24 * 3600 * 1000) d.setFullYear(d.getFullYear() - 1)
  return d.toISOString()
}

/* --------------------------------- 解析器 --------------------------------- */

function pickTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? clean(m[1]) : ''
}

function parseFeed(xml) {
  const isAtom = /<entry[\s>]/.test(xml)
  const tag = isAtom ? 'entry' : 'item'
  const blocks = [...xml.matchAll(new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, 'g'))].map((m) => m[0])

  return blocks
    .map((b) => {
      const title = pickTag(b, 'title')
      let url = ''

      const href = b.match(/<link[^>]*href="([^"]+)"/i)
      const plain = b.match(/<link[^>]*>([\s\S]*?)<\/link>/i)
      if (href && (!plain || isAtom)) url = clean(href[1])
      else if (plain) url = clean(plain[1])
      else if (href) url = clean(href[1])

      const description =
        pickTag(b, 'description') ||
        pickTag(b, 'summary') ||
        pickTag(b, 'content:encoded') ||
        pickTag(b, 'content')

      const publishedAt = parseTime(
        pickTag(b, 'pubDate') || pickTag(b, 'published') || pickTag(b, 'updated') || pickTag(b, 'dc:date')
      )

      return { title, url, description, publishedAt }
    })
    .filter((x) => x.title && /^https?:/i.test(x.url))
}

function aihotBlock(md) {
  const start = md.indexOf('［AIHOT 不可信外部资料开始］')
  const end = md.indexOf('［AIHOT 不可信外部资料结束］')
  if (start === -1) return md
  return md.slice(start, end === -1 ? undefined : end)
}

function parseAihotLatest(md) {
  const lines = aihotBlock(md).split(/\r?\n/)
  const out = []
  let cur = null

  for (const line of lines) {
    const head = line.match(/^\s*\d+\.\s*\[(.+?)\]\((.+?)\)\s*$/)
    if (head) {
      cur = { title: head[1].trim(), url: head[2].trim(), description: '', reason: '', publishedAt: null }
      out.push(cur)
      continue
    }
    if (!cur) continue

    const meta = line.match(/发布于\s*(\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})/)
    if (meta && !cur.publishedAt) cur.publishedAt = parseCnTime(meta[1])

    const reason = line.match(/推荐理由：(.+)$/)
    if (reason) {
      cur.reason = reason[1].trim()
      continue
    }
    const summary = line.match(/摘要：(.+)$/)
    if (summary) {
      cur.description = summary[1].trim()
      continue
    }
    const origin = line.match(/原文：(\S+)/)
    if (origin) cur.url = origin[1].trim()
  }
  return out
}

function parseAihotHot(md) {
  const lines = aihotBlock(md).split(/\r?\n/)
  const out = []
  let cur = null

  for (const line of lines) {
    const head = line.match(/^第\s*\d+\s*名：\[(.+?)\]\((.+?)\)\s*$/)
    if (head) {
      cur = { title: head[1].trim(), url: head[2].trim(), description: '', reason: '', publishedAt: null, heat: '' }
      out.push(cur)
      continue
    }
    if (!cur) continue

    const src = line.match(/信源：(.+?)·\s*最新进展\s*(\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})/)
    if (src) {
      cur.heat = src[1].trim()
      cur.publishedAt = parseCnTime(src[2])
    }
  }
  return out
}

function parseGitHubTrending(html) {
  const chunks = html.split('<article class="Box-row">').slice(1)
  const out = []
  for (const chunk of chunks) {
    const link = chunk.match(/<h2[\s\S]{0,200}?<a[^>]+href="\/([^"/]+\/[^"]+?)"/i)
    if (!link) continue
    const repo = link[1]
    const desc = chunk.match(/<p class="col-9[^"]*">([\s\S]*?)<\/p>/i)
    out.push({
      title: repo,
      url: `https://github.com/${repo}`,
      description: desc ? clean(desc[1]) : '',
      publishedAt: new Date().toISOString(),
      isRepo: true,
    })
  }
  return out
}

/* -------------------------------- 分类打分 -------------------------------- */

const CATEGORIES = [
  {
    id: 'resource',
    label: '教程与资源',
    words: ['教程', '指南', '入门', '课程', '公开课', '示例', '从零', 'tutorial', 'cookbook', 'course', 'awesome', 'handbook', 'quickstart', 'examples', 'getting started', 'how to'],
  },
  {
    id: 'method',
    label: '技术方法',
    words: ['论文', '方法', '架构', '基准', 'benchmark', '微调', 'fine-tune', 'rag', 'agent', '推理', '训练', '算法', 'embedding', '检索', 'prompt', 'paper'],
  },
  {
    id: 'product',
    label: '产品与工具',
    words: ['发布', '上线', '开放', '推出', '更新', '版本', '定价', 'beta', 'preview', 'release', 'launch', 'available', 'api', 'app', '工具'],
  },
  {
    id: 'industry',
    label: '行业动态',
    words: ['融资', '收购', '合作', '监管', '裁员', '政策', '诉讼', 'ipo', '估值', '营收', '财报', 'funding', 'acquire', 'lawsuit', 'ceo'],
  },
]

const STAGE_TAGS = {
  2: ['流式', 'streaming', '多轮', '结构化输出', 'function calling', '工具调用', '重试', 'token', 'sdk', '提示词工程'],
  3: ['rag', 'embedding', '向量', '检索', '知识库', 'chunk', 'rerank', '文档', '知识'],
  4: ['agent', '智能体', 'mcp', '工作流', '自动化', '多步', '工具链'],
  5: ['评测', '部署', '鉴权', '监控', '上线', '产品化', '成本核算'],
}

const HARD_SIGNALS = /github\.com|huggingface\.co\/(spaces|datasets)|colab|教程|指南|示例|cookbook|tutorial|开源|代码|实现|demo|复现/i
const SOFT_SIGNALS = /跑分|排名|榜单|观点|评论|传闻|据悉|据传|或将|疑似/i
/** 故障通报、人事、诉讼这类，对“学怎么做”没有帮助 */
const NOISE_SIGNALS = /中断|故障|宕机|恢复服务|裁员|起诉|诉讼|股价|离职|跳槽|outage|downtime|layoff|lawsuit|stock (drop|fall)/i

/** 通用技术源（非 AI 垂类）需要先判断相关性，否则 "Quoting Somebody" 这种也会上榜 */
const AI_EN =
  /\b(ai|llms?|gpt[-\w.]*|chatgpt|claude|gemini|openai|anthropic|agents?|rag|prompts?|embeddings?|fine-?tun\w*|transformers?|llama|qwen|deepseek|diffusion|multimodal|inference|neural|machine learning|model context protocol|mcp)\b/i
const AI_ZH = /(模型|智能体|大模型|训练|推理|微调|多模态|向量|检索增强|提示词|人工智能|深度学习|机器学习|神经网络|大语言)/

function aiRelevant(text) {
  return AI_EN.test(text) || AI_ZH.test(text)
}

/** ASCII 关键词按词边界匹配，中文按子串 —— 否则 guide 会命中 guideline、api 会命中 capital */
const RE_CACHE = new Map()
function keywordHit(text, word) {
  if (/^[\x20-\x7e]+$/.test(word)) {
    let re = RE_CACHE.get(word)
    if (!re) {
      re = new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i')
      RE_CACHE.set(word, re)
    }
    return re.test(text)
  }
  return text.includes(word)
}

function classify(text) {
  let best = { id: 'industry', label: '行业动态', hits: 0 }
  for (const c of CATEGORIES) {
    let hits = 0
    for (const w of c.words) if (keywordHit(text, w)) hits++
    if (hits > best.hits) best = { id: c.id, label: c.label, hits }
  }
  return best
}

function stageMatch(text, currentStage) {
  const hit = (stage) => (STAGE_TAGS[stage] || []).some((w) => keywordHit(text, w))
  if (hit(currentStage)) return 1
  if (Object.keys(STAGE_TAGS).some((s) => Number(s) !== currentStage && hit(Number(s)))) return 0.5
  return 0.2
}

function actionability(item) {
  const text = `${item.title} ${item.description} ${item.url}`
  if (NOISE_SIGNALS.test(text)) return 0.1
  if (HARD_SIGNALS.test(text)) return 1
  if (SOFT_SIGNALS.test(text)) return 0.2
  return 0.6
}

function freshness(publishedAt, now) {
  if (!publishedAt) return 0.6
  const hours = (now - new Date(publishedAt).getTime()) / 3600000
  if (!Number.isFinite(hours)) return 0.6
  return Math.max(0.05, Math.min(1, Math.exp(-Math.max(0, hours) / 24)))
}

/* ---------------------------------- 去重 ---------------------------------- */

function normalizeUrl(raw) {
  try {
    const u = new URL(raw)
    u.hash = ''
    u.hostname = u.hostname.replace(/^www\./, '').toLowerCase()
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|ref|spm|from|share)/i.test(key)) u.searchParams.delete(key)
    }
    let s = `${u.protocol}//${u.hostname}${u.pathname.replace(/\/+$/, '')}`
    const q = u.searchParams.toString()
    return q ? `${s}?${q}` : s
  } catch {
    return String(raw || '')
  }
}

function titleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function bigrams(s) {
  const set = new Set()
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
  return set
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

function wordSet(s) {
  return new Set(String(s || '').toLowerCase().match(/[a-z0-9]{2,}/g) || [])
}

/**
 * 相似度：入参是已经预计算好 key / grams / words 的条目。
 * 每次比较都重建 bigram 会让聚类退化成 O(n²) 次字符串处理。
 */
function similarPrepared(a, b) {
  const ka = a.key
  const kb = b.key
  if (!ka || !kb) return 0
  if (ka === kb) return 1

  // 长度差太大不可能是同一件事，先挡掉大部分比较
  if (Math.min(ka.length, kb.length) / Math.max(ka.length, kb.length) < 0.35) return 0

  const A = a.grams
  const B = b.grams
  let inter = 0
  for (const x of A) if (B.has(x)) inter++

  const charScore = inter / (A.size + B.size - inter || 1)
  const wordScore = jaccard(a.words, b.words)

  const containment = inter / (Math.min(A.size, B.size) || 1)
  const containScore = Math.min(ka.length, kb.length) >= 6 && containment >= 0.72 ? containment : 0

  return Math.max(charScore, wordScore, containScore)
}

/* ---------------------------------- 主流程 -------------------------------- */

async function fetchSource(src, cfg) {
  const timeout = cfg.limits?.timeoutMs || 15000
  let raw = []

  if (src.type === 'aihot') {
    const parts = await Promise.allSettled([get(src.hotUrl, timeout), get(src.url, timeout)])
    for (const part of parts) {
      if (part.status !== 'fulfilled') continue
      const md = part.value
      raw.push(...parseAihotHot(md), ...parseAihotLatest(md))
    }
    if (!raw.length) throw new Error('AIHOT 无有效条目')
  } else {
    const body = await get(src.url, timeout)
    if (src.type === 'github') raw = parseGitHubTrending(body)
    else raw = parseFeed(body)
  }

  const items = raw
    .map((item) => ({
      title: item.title,
      url: item.url,
      description: item.description || '',
      reason: item.reason || '',
      heat: item.heat || '',
      publishedAt: item.publishedAt || null,
      source: src.name,
      kind: src.kind || 'news',
      ignoreDescription: src.ignoreDescription === true,
      fallbackSummary: src.fallbackSummary || '',
      sourceWeight: src.weight ?? 0.7,
      lang: src.lang || 'en',
    }))
    .filter((item) => item.title && /^https?:/i.test(item.url))
    .filter((item) => item.kind === 'repo' || !/^[\w.-]+\/[\w.-]+$/.test(item.title.trim()))

  // 非 AI 垂类源（GitHub / HN / 个人博客）先按相关性过滤，避免噪音占榜
  return src.aiOnly ? items.filter((item) => aiRelevant(`${item.title} ${item.description}`)) : items
}

function buildItems(items, currentStage, now, maxAgeHours = 96, maxItems = 8) {
  const maxAge = maxAgeHours * 3600 * 1000

  // 1. 先按时间过滤再聚类：OpenAI 这类源会返回整个历史库（1000+ 条），
  //    不先筛掉旧数据，聚类就是上百万次比较。
  const fresh = []
  for (const item of items) {
    if (item.publishedAt && now - new Date(item.publishedAt).getTime() >= maxAge) continue
    item.urlKey = normalizeUrl(item.url)
    item.key = titleKey(item.title)
    item.grams = bigrams(item.key)
    item.words = wordSet(item.title)
    fresh.push(item)
  }

  // 2. 聚类去重（相似度用预计算好的 bigram 集，避免每次重建）
  const clusters = []
  for (const item of fresh) {
    let target = null
    for (const c of clusters) {
      if (c.some((m) => m.urlKey === item.urlKey || similarPrepared(m, item) > 0.6)) {
        target = c
        break
      }
    }
    if (target) target.push(item)
    else clusters.push([item])
  }

  // 3. 合并 + 打分
  const merged = clusters.map((cluster) => {
    cluster.sort((a, b) => b.sourceWeight - a.sourceWeight || (b.description.length - a.description.length))
    const head = cluster[0]
    const others = cluster.slice(1)
    const text = `${head.title} ${head.description}`
    const category = classify(text)
    const stage = stageMatch(text, currentStage)
    const act = actionability(head)
    const fresh = freshness(head.publishedAt, now)
    const score = 0.4 * stage + 0.3 * act + 0.2 * fresh + 0.1 * head.sourceWeight

    const alsoReportedBy = [...new Set(others.map((o) => o.source))].filter((s) => s !== head.source)

    const heatCount = Number((head.heat || '').match(/（\s*(\d+)\s*个/)?.[1] || 0)
    const totalReports = Math.max(heatCount, alsoReportedBy.length + 1)

    let summary = head.reason
    if (!summary && (heatCount >= 2 || alsoReportedBy.length >= 1)) {
      const names = (head.heat || '')
        .replace(/（\s*\d+\s*个）/, '')
        .split('、')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 2)
      const list = [...names, ...alsoReportedBy].slice(0, 2).join('、')
      if (list) summary = totalReports > 2 ? `${list} 等 ${totalReports} 家来源在报道。` : `${list} 两家来源在报道。`
    }
    if (!summary && head.description && !head.ignoreDescription) summary = firstSentence(head.description, 78)
    if (!summary && head.fallbackSummary) summary = head.fallbackSummary
    if (!summary) summary = `来自 ${head.source} 的最新动态，点开看原文。`

    return {
      id: crypto.createHash('sha1').update(head.urlKey).digest('hex').slice(0, 12),
      title: head.title,
      url: head.url,
      source: head.source,
      publishedAt: head.publishedAt,
      category: category.id,
      categoryLabel: category.label,
      summary,
      score: Number(score.toFixed(3)),
      alsoReportedBy,
      lang: head.lang,
    }
  })

  // 4. 排序（时间过滤已在第 1 步做完）
  const sorted = merged.sort((a, b) => b.score - a.score)

  // 5. 多样性：单类最多 4 条，避免整屏都是融资新闻
  const picked = []
  const counts = {}
  for (const item of sorted) {
    if (picked.length >= maxItems) break
    if ((counts[item.category] || 0) >= 4) continue
    picked.push(item)
    counts[item.category] = (counts[item.category] || 0) + 1
  }

  // 6. 教程类保底 1 条：有候选就挤掉一条同质内容
  if (!counts.resource) {
    const resource = sorted.find((i) => i.category === 'resource' && !picked.includes(i))
    if (resource) {
      const idx = picked.map((i) => counts[i.category]).lastIndexOf(Math.max(...picked.map((i) => counts[i.category])))
      if (idx !== -1 && counts[picked[idx].category] > 1) {
        counts[picked[idx].category]--
        picked[idx] = resource
        counts.resource = 1
      }
    }
  }

  return picked.sort((a, b) => b.score - a.score)
}

async function main() {
  const cfg = JSON.parse(await fs.readFile(path.join(ROOT, 'sources.json'), 'utf8'))
  const now = Date.now()

  const net = createDispatcher(cfg.proxy)
  dispatcher = net.dispatcher
  console.log(net.proxy ? `[fetch] 走代理 ${net.proxy.replace(/\/\/.*@/, '//***@')}` : '[fetch] 直连（未检测到代理）')

  let currentStage = cfp(cfg.currentStage, 2)
  try {
    const roadmap = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'roadmap.json'), 'utf8'))
    if (roadmap.currentStage) currentStage = roadmap.currentStage
  } catch {
    /* roadmap 还没写就用默认值 */
  }

  const enabled = (cfg.sources || []).filter((s) => s.enabled !== false)
  console.log(`[fetch] 开始抓取 ${enabled.length} 个源…`)

  const results = await mapLimit(enabled, cfg.limits?.concurrency || 4, async (src) => {
    const started = Date.now()
    try {
      const items = await fetchSource(src, cfg)
      console.log(`[fetch] ✓ ${src.name.padEnd(16)} ${items.length} 条  ${Date.now() - started}ms`)
      return { src, items, status: 'ok' }
    } catch (err) {
      console.log(`[fetch] ✗ ${src.name.padEnd(16)} ${err.message}`)
      return { src, items: [], status: 'failed', error: err.message }
    }
  })

  const all = results.flatMap((r) => r.items)
  const sources = Object.fromEntries(results.map((r) => [r.src.id, r.status]))
  const degraded = results.filter((r) => r.status !== 'ok').map((r) => r.src.id)

  const newsItems = all.filter((i) => i.kind !== 'repo')
  const repoItems = all.filter((i) => i.kind === 'repo')

  const maxItems = cfg.limits?.maxItems || 8
  const items = buildItems(newsItems, currentStage, now, cfg.limits?.maxAgeHours || 96, maxItems)

  // 仓库不进新闻流，单独作为「今日新发现」
  const discoveries = repoItems.slice(0, 5).map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description ? firstSentence(r.description, 90) : '',
    source: r.source,
  }))

  const payload = {
    fetchedAt: new Date(now).toISOString(),
    currentStage,
    sources,
    degraded,
    totalCandidates: all.length,
    items,
    discoveries,
  }

  await fs.mkdir(DATA_DIR, { recursive: true })

  // 全挂时保留上一次数据，只更新失败信息
  if (!items.length) {
    try {
      const prev = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'news.json'), 'utf8'))
      if (prev.items?.length) {
        prev.stale = true
        prev.lastAttemptAt = payload.fetchedAt
        prev.sources = sources
        await fs.writeFile(path.join(DATA_DIR, 'news.json'), JSON.stringify(prev, null, 2), 'utf8')
        console.log(`[fetch] 本轮无结果，保留上次 ${prev.items.length} 条`)
        return
      }
    } catch {
      /* 没有历史数据 */
    }
  }

  await fs.writeFile(path.join(DATA_DIR, 'news.json'), JSON.stringify(payload, null, 2), 'utf8')

  console.log(`[fetch] ${all.length} 条候选 → ${items.length} 条入选`)
  for (const item of items) {
    console.log(`         ${item.score.toFixed(2)}  [${item.categoryLabel}] ${item.title.slice(0, 42)}`)
  }
  if (degraded.length) console.log(`[fetch] 降级源：${degraded.join(', ')}`)
}

function cfp(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

main()
  .catch((err) => {
    console.error('[fetch] 失败：', err)
    process.exitCode = 1
  })
  .finally(async () => {
    // 不关连接池的话，undici 的 keep-alive 会把进程拖住几十秒
    if (dispatcher?.close) await dispatcher.close()
  })
