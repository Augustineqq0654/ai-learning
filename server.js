/**
 * server.js
 * 三件事：发静态文件、触发一次抓取、把 records/ 里的 Markdown 渲染成页面。
 * 只监听 127.0.0.1，不对外暴露。
 */

import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { plainText, renderMarkdown } from './lib/markdown.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 5173)
const HOST = '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
}

let refreshing = null

function sendJson(res, code, data) {
  const body = JSON.stringify(data)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function serveFile(res, filePath) {
  try {
    const stat = await fsp.stat(filePath)
    if (!stat.isFile()) throw new Error('not a file')
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.json' ? 'no-store' : 'no-cache',
      'content-length': stat.size,
    })
    fs.createReadStream(filePath).pipe(res)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Not found')
  }
}

/**
 * 把请求路径解析到 base 之内，越界或无法解码时返回 null。
 * 用 path.relative 判断包含关系：startsWith 会把兄弟目录（data-evil）当成 base。
 */
function safeJoin(base, requestPath) {
  let decoded
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null

  const full = path.resolve(base, decoded.replace(/\\/g, '/').replace(/^\/+/, ''))
  const rel = path.relative(base, full)
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null
  return full
}

const SCRIPTS = ['fetch-data.js', 'fetch-models.js']

function runScript(script) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(ROOT, script)],
      { cwd: ROOT, timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024 * 4 },
      (err, stdout, stderr) => {
        resolve({
          script,
          ok: !err,
          stdout: stdout || '',
          stderr: stderr || '',
          error: err ? String(err.message) : null,
        })
      }
    )
  })
}

async function handleRefresh(res) {
  if (refreshing) {
    sendJson(res, 202, { ok: true, running: true })
    return
  }

  refreshing = Promise.all(SCRIPTS.map((script) => runScript(script)))

  let results = []
  try {
    results = await refreshing
  } finally {
    refreshing = null
  }

  for (const r of results) {
    if (r.stdout.trim()) console.log(r.stdout.trim())
    if (!r.ok) console.error(r.stderr.trim() || r.error)
  }

  const ok = results.some((r) => r.ok)
  sendJson(res, ok ? 200 : 500, { ok, results })
}

/* --------------------------------- 学习记录 -------------------------------- */

const RECORDS_DIR = path.join(ROOT, 'records')
const RECORD_MAX_BYTES = 2 * 1024 * 1024
const HEAD_BYTES = 8 * 1024

/** 只读文件开头，够取标题和摘要就行，避免列表页把每个文件整读一遍 */
function readHead(file, bytes = HEAD_BYTES) {
  try {
    const fd = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(bytes)
    const read = fs.readSync(fd, buffer, 0, bytes, 0)
    fs.closeSync(fd)
    return buffer.subarray(0, read).toString('utf8')
  } catch {
    return ''
  }
}

function titleOf(markdown, file) {
  const heading = String(markdown)
    .replace(/^\uFEFF/, '')
    .split('\n')
    .find((line) => /^#\s+\S/.test(line))
  if (heading) return heading.replace(/^#\s+/, '').trim()
  return path.basename(file, path.extname(file))
}

function collectRecords(dir, prefix, acc) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      collectRecords(full, `${prefix}${entry.name}/`, acc)
      continue
    }
    if (!/\.md$/i.test(entry.name)) continue

    let stat
    try {
      stat = fs.statSync(full)
    } catch {
      continue
    }
    if (!stat.isFile() || stat.size > RECORD_MAX_BYTES) continue

    const head = readHead(full)
    acc.push({
      file: `${prefix}${entry.name}`,
      title: titleOf(head, entry.name),
      excerpt: plainText(head),
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    })
  }
  return acc
}

function listRecords() {
  return collectRecords(RECORDS_DIR, '', []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function readRecord(requestPath) {
  let decoded
  try {
    decoded = decodeURIComponent(String(requestPath || '').replace(/^\/+/, ''))
  } catch {
    return null
  }
  if (!decoded || decoded.includes('\0')) return null

  const full = path.resolve(RECORDS_DIR, decoded)
  const rel = path.relative(RECORDS_DIR, full)
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null
  if (!/\.md$/i.test(full)) return null

  let stat
  try {
    stat = fs.statSync(full)
  } catch {
    return null
  }
  if (!stat.isFile() || stat.size > RECORD_MAX_BYTES) return null

  const source = fs.readFileSync(full, 'utf8')
  return {
    file: rel.split(path.sep).join('/'),
    title: titleOf(source, rel),
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    html: renderMarkdown(source),
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const pathname = url.pathname

  if (pathname === '/api/news') {
    return serveFile(res, path.join(ROOT, 'data', 'news.json'))
  }

  if (pathname === '/api/refresh') {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' })
      return res.end()
    }
    return handleRefresh(res)
  }

  if (pathname === '/api/records') {
    const items = listRecords()
    return sendJson(res, 200, { count: items.length, items })
  }

  if (pathname.startsWith('/api/records/')) {
    const record = readRecord(pathname.slice('/api/records'.length))
    return record ? sendJson(res, 200, record) : sendJson(res, 404, { error: 'not found' })
  }

  if (pathname.startsWith('/data/')) {
    const target = safeJoin(path.join(ROOT, 'data'), pathname.slice('/data'.length))
    return target ? serveFile(res, target) : sendJson(res, 400, { error: 'bad path' })
  }

  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const target = safeJoin(path.join(ROOT, 'public'), relative)
  return target ? serveFile(res, target) : sendJson(res, 400, { error: 'bad path' })
})

server.listen(PORT, HOST, () => {
  console.log('')
  console.log('  AI 学习驾驶舱已启动')
  console.log(`  打开  http://${HOST}:${PORT}`)
  console.log('')
  console.log('  首次使用先抓一次数据：npm run update')
  console.log('  或直接点页面右上角的「立即更新」')
  console.log('')
})
