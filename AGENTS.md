# AGENTS.md — AI 学习驾驶舱

本地单人用的 AI 学习看板：7 个页面，零构建，数据落 JSON，学习进度存浏览器 localStorage。

## 怎么跑

```bash
npm install          # 首次
npm run update       # 抓新闻 + 选型 + 提示词（前两项联网，提示词读本机插件）
npm run dev          # 起服务 http://127.0.0.1:5173
npm run daily        # update + dev
```

- 改 `server.js` 或 `lib/*.js` 要重启服务；改 `data/*.json`、`public/` 下的文件刷新页面即可。
- `npm run update:prompts` 依赖本机已装 `dsh-prompt`（默认找 `~/.dsh/profiles/{desktop,web}`）；没装只警告，不覆盖 `data/prompts.json`。

## 技术栈

- 服务：Node 原生 `http`（`server.js`），唯一依赖 `undici`（抓取走代理）
- 前端：原生 ES Module，无框架无构建；`public/js/boot.js` 取数后调当前页 `pages/<page>.js` 的 `render()`
- Markdown：`lib/markdown.js` 自写渲染，默认转义 HTML，不放行内联 HTML

## 目录与约定

- `public/js/pages/*.js` 一页一个模块，页面之间不互相 import；共享工具、状态和数据容器在 `public/js/core.js`
- 样式只用 `public/css/style.css` 里的纸墨 token（`--ink` / `--muted` / `--accent` / `--line` …），不写死颜色
- `data/`：`roadmap.json`、`projects.json`、`tutorials.json` 手写；`news.json` 由 `fetch-data.js` 生成且被 gitignore；`models.json` 价格与名次自动、人工字段保留；`prompts.json` 由 `fetch-prompts.js` 生成
- `records/`：用户自己的 Markdown 笔记，支持子文件夹，不放代码
- 路由：`GET /api/news`、`POST /api/refresh`、`GET /api/records`、`GET /api/records/<路径>`、`/data/*`、`public/` 静态文件

## 当前状态 / 下一步

- 已完成：7 页（速览 / 学习 / 项目库 / 教程 / 选型 / 提示词 / 记录）、7 个新闻源 + 选型自动更新、Markdown 记录页
- 数据：新闻 8 条、5 阶段 30 任务、9 个项目、13 个教程、5 场景 / 27 个 Go 模型、24 条提示词
- 待做（PLAN.md 的 M3）：Windows 计划任务每日更新、项目库排序筛选、可选 LLM 摘要、新闻搜索归档
- 已知：`/favicon.ico` 返回 404（没做图标）；服务只监听 127.0.0.1，无鉴权
