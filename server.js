/**
 * server.js
 * 两件事：发静态文件、触发一次抓取。
 * 只监听 127.0.0.1，不对外暴露。
 */

import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

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

function safeJoin(base, requestPath) {
  const decoded = decodeURIComponent(requestPath)
  const full = path.join(base, decoded)
  return full.startsWith(base) ? full : null
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
