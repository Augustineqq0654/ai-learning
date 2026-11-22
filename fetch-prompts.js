/**
 * fetch-prompts.js
 * 从已安装的 dsh-prompt 插件里抽出预置 prompt 模板，写成 data/prompts.json。
 *
 * 数据源：<profile>/node_modules/dsh-prompt/lib/client.js 里的 PRESET_TEMPLATES 数组。
 * 插件升级后重跑一次即可；抽不到就保持退出码 0，不覆盖已有 JSON。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(ROOT, 'data', 'prompts.json')
const MARKER = 'const PRESET_TEMPLATES = ['

/** 候选安装位置：环境变量 → desktop/web 两个默认 profile */
function candidates() {
  const list = []
  const extra = process.env.DSH_PROMPT_DIR
  if (extra) list.push(extra)
  if (process.env.DSH_PROFILE_DIR) list.push(path.join(process.env.DSH_PROFILE_DIR, 'node_modules', 'dsh-prompt'))
  for (const profile of ['desktop', 'web']) {
    list.push(path.join(os.homedir(), '.dsh', 'profiles', profile, 'node_modules', 'dsh-prompt'))
  }
  return list
}

function findPackage() {
  for (const dir of candidates()) {
    const entry = path.join(dir, 'lib', 'client.js')
    const manifest = path.join(dir, 'package.json')
    if (fs.existsSync(entry) && fs.existsSync(manifest)) {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'))
      return { dir, entry, name: pkg.name, version: pkg.version }
    }
  }
  return null
}

/**
 * 从 `[` 开始扫到配对的 `]`，跳过字符串与注释，避免正文里的括号干扰。
 */
function sliceArray(text, openIndex) {
  let depth = 0
  let i = openIndex
  let quote = null

  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]

    if (quote) {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i += 1
      continue
    }

    if (ch === '/' && next === '/') {
      const nl = text.indexOf('\n', i)
      i = nl === -1 ? text.length : nl + 1
      continue
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      i += 1
      continue
    }
    if (ch === '[') depth += 1
    if (ch === ']') {
      depth -= 1
      if (depth === 0) return text.slice(openIndex, i + 1)
    }
    i += 1
  }
  return null
}

function extract(entry) {
  const src = fs.readFileSync(entry, 'utf8')
  const at = src.indexOf(MARKER)
  if (at < 0) throw new Error(`没找到 ${MARKER}`)

  const openIndex = at + MARKER.length - 1
  const literal = sliceArray(src, openIndex)
  if (!literal) throw new Error('PRESET_TEMPLATES 数组没有闭合')

  const presets = vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 2000 })
  if (!Array.isArray(presets) || !presets.length) throw new Error('PRESET_TEMPLATES 不是数组')

  return presets
    .filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.body === 'string')
    .map((t) => ({
      id: t.id,
      name: t.name,
      nameEn: t.nameEn || '',
      domain: t.domain || '',
      stage: t.stage || '',
      action: Array.isArray(t.action) ? t.action : [],
      labels: Array.isArray(t.labels) ? t.labels : [],
      body: t.body,
    }))
}

function main() {
  const found = findPackage()
  if (!found) {
    console.warn('[prompts] 没找到已安装的 dsh-prompt，跳过；data/prompts.json 保持原样')
    console.warn(`[prompts] 找过这些位置：\n  ${candidates().join('\n  ')}`)
    return
  }

  const items = extract(found.entry)
  const payload = {
    exportedAt: new Date().toISOString(),
    source: {
      package: found.name,
      version: found.version,
      file: path.relative(path.dirname(found.dir), found.entry).split(path.sep).join('/'),
    },
    count: items.length,
    items,
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`[prompts] ${found.name}@${found.version} → ${items.length} 条模板 → data/prompts.json`)
}

main()
