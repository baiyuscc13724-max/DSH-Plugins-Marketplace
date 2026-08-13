# DSH插件市场（dsh-plugin-marketplace）

🌐 **语言 / Language:** **中文** | [English](README.en.md)

一个为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）打造的插件市场插件：从 GitHub 的 [`dsh-plugin` topic](https://github.com/topics/dsh-plugin) 拉取全部插件，在 DSH Web GUI 的设置页中以卡片列表展示，支持**一键安装 / 自动更新 / 版本检测 / 已安装识别**，全程无需命令行。

![类型](https://img.shields.io/badge/类型-客户端%2B服务端插件-blue) ![平台](https://img.shields.io/badge/平台-Web%20GUI-lightgrey)

---

## ✨ 功能特性

- **全量拉取**：每次启动 DSH 时自动从 GitHub 拉取 `topic:dsh-plugin` 下的**全部**插件（分页翻到底），并**按 Star 数从高到低**排列，缓存 10 分钟
- **一键安装**：每个插件卡片带「安装」按钮，点击后自动完成：克隆仓库 → 识别类型 → 扫描所需环境变量 → 执行安装
- **智能类型识别**：自动区分并安装以下类型的仓库：
  - `skill`（含 `SKILL.md`）→ 安装到 `~/.dsh/skills/`
  - agent 预设（含 `preset.yml` + `agent.cordis.yml`）→ 安装到 `~/.dsh/.agent-presets/`
  - cordis 插件（含 `package.json`）→ 安装依赖并注册到 web profile
  - 安装脚本（`install.sh` / `install.ps1`）→ 执行脚本
- **用户材料介入**：当插件需要 `API_KEY` / `TOKEN` / `SECRET` 等环境变量时，**安装自动暂停**，在页面内弹窗请你提供材料（或跳过），不会盲装
- **脚本执行确认**：检测到第三方安装脚本时先征求你的确认（安全提示），拒绝即取消
- **已安装识别**：四重判定——安装清单（`installed.json`）+ 目录启发式探测 + 包名映射扫描 + 本体 `repository` 自识别，已安装的插件按钮变为不可点击的灰色「已安装」
- **中英双语**：界面与安装日志跟随 DSH 的语言设置自动切换 中文 / English（设置 → 常规 → Language）
- **版本检测与更新**：cordis 插件自动对比已装版本与仓库最新版本（从本地缓存读取，零额外网络请求），不一致时按钮变为「更新」，点击即可覆盖升级
- **搜索**：按插件名 / 仓库全名 / 标签实时过滤
- **刷新反馈**：点「刷新」强制重新拉取，并以弹窗提示「刷新成功 / 刷新失败」
- **Github原链**：每个卡片提供跳转到原仓库的链接（新标签页打开）
- **深浅色适配**：全部使用 DSH 主题令牌（`--dsw-alias-*`），自动适配深色 / 浅色模式
- **排除本体**：硬编码排除 `deepseek-harness`（DSH 自身仓库，不属于插件）

---

## 📦 安装本插件

本插件位于 `~/.dsh/profiles/web/node_modules/dsh-plugin-marketplace/`，并通过 `~/.dsh/profiles/web/cordis.patch.yml` 注册：

```yaml
- insert:
    - id: plugin-marketplace
      name: dsh-plugin-marketplace
```

> ⚠️ **重启生效**：DSH 的 Web profile 关闭了配置热重载（`hmr` 被禁用），修改插件代码或注册条目后需要**重启 DSH**（重新运行 `dsh web` 或 `start-dsh.bat`）再刷新页面。

---

## 🚀 使用方法

1. 重启 DSH 后打开 Web GUI，进入 **设置 → DSH插件市场**
2. 页面自动加载全部插件（按 Star 排序），也可点击「刷新」强制重新拉取
3. 使用搜索框按名字过滤插件
4. 点击插件卡片上的按钮：
   - **安装** → 开始安装，日志实时滚动
   - 需要材料时 → 页面弹出输入框，提供 API Key 等后点「提交材料并继续安装」
   - **更新** → 检测到新版本时覆盖升级
   - **已安装**（灰色）→ 无需操作

---

## 🔧 工作原理

### 安装流程（5 步）

```
[1/5] git clone 仓库到 ~/.dsh/marketplace/cache/<owner>__<name>/
[2/5] 识别类型（SKILL.md / agent 预设 / 安装脚本 / package.json）
[3/5] 扫描 README / install 脚本 / .env 示例中的环境变量（API_KEY 等）
      └─ 发现需要 → 暂停安装，等待用户提供材料（可跳过）
[4/5] 执行安装（复制 skill / 预设 / 插件包，或运行安装脚本）
      └─ 脚本类 → 先征求用户确认（第三方代码风险提示）
[5/5] 写入安装清单（installed.json）并返回结果
```

### 版本检测逻辑

| 数据 | 来源 |
|---|---|
| 已装版本 | `installed.json` 记录；历史安装无记录时读取安装目录 `package.json` |
| 最新版本 | 市场缓存克隆目录 `~/.dsh/marketplace/cache/<owner>__<name>/package.json` |

两者都存在且不一致 → 卡片显示「更新」按钮 + `已装 vX → vY` 提示。
（仅对含 `package.json` 的 cordis 插件生效；skill / 预设 / 脚本类无版本概念。）

### 已安装判定（四重）

1. `~/.dsh/marketplace/installed.json` 安装清单（本插件安装的）
2. 目录启发式探测：`~/.dsh/skills/<名>`、`~/.dsh/.agent-presets/<名>`、`profiles/web/node_modules/<名>`（含原始仓库名目录）、市场缓存目录
3. 包名映射：扫描已安装目录的 `package.json` 名称，与仓库名/缓存克隆包名比对——仓库名与包名不一致（如 `DSH-Plugins-Marketplace` → `dsh-plugin-marketplace`）也能识别，并正确读出已装版本
4. 本体识别：仓库命中本插件自身 `package.json` 的 `repository` 字段即视为已安装（市场不会把自己的仓库显示为「安装」）

---

## 📁 文件结构

```
~/.dsh/
├── profiles/web/
│   ├── node_modules/dsh-plugin-marketplace/   ← 本插件本体
│   │   ├── package.json        （dsh.client 声明 + exports）
│   │   └── lib/
│   │       ├── index.js        （服务端：GitHub 拉取 / 安装管线 / 版本检测）
│   │       └── client.js       （客户端：市场页面 UI）
│   └── cordis.patch.yml        （插件注册条目）
└── marketplace/
    ├── cache/<owner>__<name>/  （克隆缓存，安装与版本对比的数据源）
    └── installed.json          （已安装清单：type / name / location / version / installedAt）
```

---

## 📡 HTTP 接口

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/marketplace/list` | GET | 插件列表（按 Star 降序，含 `installed` / `installedVersion` / `latestVersion` / `updateAvailable`）；`?refresh=1` 强制重新拉取 |
| `/api/marketplace/install` | POST | 安装 / 更新，body：`{ "repo": "owner/name", "answers": { "ENV_NAME": "值" } }`；返回 `done` / `awaiting-input` / `aborted` / `failed` 状态 + 逐步日志 |

---

## ⚠️ 安全说明

- 安装即信任该仓库：安装脚本（`install.sh` / `install.ps1`）会在你的机器上**执行任意代码**，市场会在执行前弹出确认
- 你提供的 API Key 等材料只作为**本次安装的环境变量**传入，不会写入任何持久化文件（安装脚本自身的行为除外）
- 插件包会被复制到 web profile 并注册到 `cordis.patch.yml`——这意味着它会随 DSH 启动加载，请只安装你信任的仓库

---

## 🔄 已知限制

- 版本检测仅对含 `package.json` 的插件生效；skill / 预设 / 脚本类无版本概念
- GitHub 搜索 API 未认证限流 **10 次/分钟**，频繁点「刷新」可能触发限流（此时会提示刷新失败，稍等再试）
- 安装脚本类插件的「已安装」判定基于缓存目录存在性，卸载（删除缓存）后会重新显示为可安装
- 插件代码修改后需**重启 DSH** 才能生效（Web profile 的 HMR 处于禁用状态）

---

## 🛠️ 开发与维护

- 修改服务端逻辑：编辑 `lib/index.js`（语法检查：`node --check`）
- 修改页面 UI：编辑 `lib/client.js`（浏览器 bundle，`window.__ModuleLoader__.load` 格式，`require` 可解析 DSH 平台模块）
- 修改后重启 DSH 生效；客户端 bundle 的版本号（rev）按内容哈希生成，重启后浏览器自动拉取新版本

---

## 📄 许可

MIT
