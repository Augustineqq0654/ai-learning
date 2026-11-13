# AI 学习驾驶舱

每天打开，3 秒内知道今天该学什么、有什么值得看。

五个页面，固定顶部导航切换：

- **速览** `/` —— 自动抓取 7 个源，去重打分，只留 8 条
- **学习** `/study.html` —— 我在这一步 + 今日任务，每天只推 1 个任务
- **项目库** `/projects.html` —— 9 个把 AI 用出效果的项目，不写代码，每个附教程
- **教程** `/tutorials.html` —— 13 个常驻教程，优先 GitHub / 知乎 / 博客园
- **选型** `/models.html` —— 12 个场景的首选 / 备选模型 + OpenCode Go 常用模型与用量榜

## 快速开始

最简单：双击 `start.bat`。它会自动抓数据、起服务、打开浏览器。

命令行方式：

```bash
npm install
npm run update   # 抓一次新闻 + 选型数据
npm run dev      # 打开 http://127.0.0.1:5173
```

之后每天只需要：

```bash
npm run daily    # 先抓数据，再起服务
```

不想敲命令，也可以打开页面后点右上角「更新」。页面发现数据过期（新闻超过 6 小时、选型超过 1 天）会自动在后台跑一次，不用手动点。

服务在一个最小化的窗口里跑，标题是 `AI Learning Server`。关掉那个窗口就停止服务；重复双击 `start.bat` 不会起第二个进程，只会再打开一次页面。

## 数据从哪来

| 源 | 类型 |
|---|---|
| AIHOT、量子位 | 中文 AI 资讯 |
| OpenAI、Google DeepMind | 官方博客 |
| Simon Willison、Hacker News | 英文技术社区 |
| GitHub Trending | 今日热门仓库（单独展示） |
| OpenRouter | 模型价格、上下文长度、周榜名次（选型页） |

选型页只自动更新能验证的部分：**价格**和**榜单名次**。额度、场景推荐、用途说明是人工维护的，不会被覆盖；用量数字 OpenRouter 没有公开接口，所以不显示，也不猜。

代理会自动发现：先读 `sources.json` 里的 `proxy`，再看 `HTTPS_PROXY` 环境变量，最后读 Windows 系统代理设置。三者都没有就直连。检测不到代理也不影响中文源。

## 改哪里

- 增删数据源 → `sources.json`
- 改学习路径、任务 → `data/roadmap.json`
- 改项目库 → `data/projects.json`
- 改教程清单 → `data/tutorials.json`
- 改模型选型 → `data/models.json`
- 改配色和排版 → `public/style.css`

学习进度存在浏览器的 localStorage，不备份也不上传。清缓存会丢进度。

## 实现要点

- 零构建：原生 HTML / CSS / JS，改完刷新就生效
- 唯一依赖 `undici`，用于走代理
- 单源失败不影响整体，页面照常显示其余内容
- 一轮全挂时保留上次数据，不会白屏

更完整的设计说明见 [PLAN.md](./PLAN.md)。
