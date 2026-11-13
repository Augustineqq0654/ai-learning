/**
 * lib/net.js
 * 共用的 HTTP 层：代理发现、超时、重试。
 * Node 内置 fetch 不读系统代理，国内直连 GitHub / OpenRouter 会超时，所以统一走这里。
 */

import { execFileSync } from 'node:child_process'
import { fetch, ProxyAgent } from 'undici'

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export function normalizeProxy(raw) {
  const first = String(raw || '').split(';').map((s) => s.trim()).filter(Boolean)[0]
  if (!first) return null
  const value = first.includes('=') ? first.split('=').pop().trim() : first
  if (!value) return null
  return /^https?:\/\//i.test(value) ? value : `http://${value}`
}

/** 顺序：配置文件 → 环境变量 → Windows 系统代理 */
export function detectProxy(configured) {
  if (configured) return normalizeProxy(configured)

  const env = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
  if (env) return normalizeProxy(env)

  if (process.platform === 'win32') {
    try {
      const out = execFileSync(
        'reg',
        ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
        { encoding: 'utf8', windowsHide: true, timeout: 4000 }
      )
      if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(out)) return null
      const m = out.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)
      return m ? normalizeProxy(m[1]) : null
    } catch {
      return null
    }
  }
  return null
}

export function createDispatcher(configured) {
  const proxy = detectProxy(configured)
  return { proxy, dispatcher: proxy ? new ProxyAgent(proxy) : undefined }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function fetchText(url, options = {}) {
  const { dispatcher, timeoutMs = 15000, retries = 1, headers = {} } = options
  if (!url) throw new Error('empty url')

  let lastError
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': UA,
          accept: '*/*',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          ...headers,
        },
        dispatcher,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (err) {
      lastError = err
      if (i < retries) await sleep(600)
    }
  }
  throw lastError
}

export async function fetchJson(url, options = {}) {
  const text = await fetchText(url, {
    ...options,
    headers: { accept: 'application/json', ...(options.headers || {}) },
  })
  return JSON.parse(text)
}
