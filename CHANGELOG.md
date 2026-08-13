# 更新日志 / Changelog

本仓库的版本迭代记录。**v1.0.0 之前的版本均为 beta 系列**（开发期迭代，未单独打 tag）。/ Version history of this repository. **All versions before v1.0.0 are part of the beta series** (development iterations, not individually tagged).

---

## Unreleased / 未发布

- **npm 生命周期脚本确认弹窗**：cordis 插件含 `prepare` / `install` / `postinstall` 等脚本时，安装前弹窗征求确认——「允许执行」则按用户授权运行脚本（含回退链），「不允许」则取消安装并清理全部痕迹 / npm lifecycle script confirmation dialog: plugins with `prepare` / `install` / `postinstall` etc. now ask for explicit consent before running scripts — «Allow» runs them as authorized (with fallback chain), «Deny» cancels the install and cleans up all traces

---

## v1.0.0 — 2026-08-14（正式版 / Stable）

- 🎉 首个正式版本发布 / First stable release
- 新增社交预览封面（1280×640 分享图）/ Social preview image added
- README 增加徽章组（DeepSeek Harness 生态 / Stars / License / Registry CI / Last Commit / i18n）/ README badge group added
- 发布 GitHub Release v1.0.0 / GitHub Release v1.0.0 published

---

## v0.9.0-beta — 2026-08-14（安全加固 / Security hardening）

基于独立代码审查完成全面加固 / Hardened after an independent code review:

- **CSRF 防护**：安装端点校验自定义头 `X-DSH-Marketplace` + Origin 必须与 Host 一致，阻止恶意网页伪造"脚本确认"静默安装 / CSRF protection: custom header + Origin check on the install endpoint
- **包名白名单与路径包含校验**：`pkg.name` 按 npm 命名规则校验，目标路径必须在 profile node_modules 内，杜绝路径穿越 / 任意目录删除 / YAML 注入 / Package-name whitelist + path containment (no path traversal / arbitrary delete / YAML injection)
- **环境变量键白名单**：`answers` 只放行扫描确认的变量名，`__` 内部键不进环境，防止 PATH/HOME 劫持 / env key whitelist for `answers`
- **依赖脚本默认不执行**：`npm install` 默认 `--ignore-scripts`，第三方 prepare/install 脚本不再静默运行 / npm deps installed with `--ignore-scripts` by default
- **URL 协议校验**：`html_url` 仅放行 `https://github.com`，杜绝 `javascript:` XSS 向量 / URL protocol validation against `javascript:` XSS
- **并发互斥**：同一仓库安装加锁（重复请求 409），patch 写入串行化 + 临时文件原子 rename / per-repo install lock + atomic patch writes
- **请求体上限**：1 MB 超限返回 413，防内存耗尽 / 1 MB request body limit (413)
- **注册判定行级精确匹配**：`name: <pkg>` 按行匹配，前缀包名不再误判已注册 / exact line-based patch matching
- **密钥输入框改密码模式** / secret inputs now use `type="password"`
- **列表检测并行化**（并发 12）/ parallel installed-detection (concurrency 12)
- **语义化版本比较**：`1.0.0 > 1.0.0-rc.1` 判断正确 / semver-aware version comparison
- **环境变量检测增强**：支持 camelCase 形态，`BY_PASS` 等词不再误伤 / improved env-var scan (camelCase), no more `BY_PASS` false positives
- **registry 陈旧条目清理**：partial 合并时超过 14 天未出现的仓库自动剔除 / stale registry entries pruned after 14 days
- **CI 语法检查步骤** / syntax-check step added to CI

---

## v0.8.0-beta — 2026-08-14（Windows 安装管线修复 / Windows install pipeline fixes）

- **修复 `spawn npm ENOENT` / `EINVAL`**：Windows 上 `execFile` 无法启动 npm 的 `.cmd` 批处理，改用 `node.exe + npm-cli.js` 直接启动，不依赖 PATH / fixed `spawn npm ENOENT`/`EINVAL` by launching `node.exe + npm-cli.js` directly
- **依赖安装回退链**：peer 冲突自动改 `--legacy-peer-deps`（DSH 宿主已提供 `@deepseek-ai/*` peer）/ dependency fallback chain with `--legacy-peer-deps`
- **cordis 插件保留 `node_modules`**：带依赖的插件复制时不再排除依赖目录 / cordis plugins keep their `node_modules`
- **安装记录先写盘再入内存**：持久化失败不再留下脏的"已安装"状态 / install records persist before committing to memory
- **安装失败自动清理缓存**：失败不再残留克隆目录 / failed installs clean up their clone cache

---

## v0.7.0-beta — 2026-08-13（免责声明 / Disclaimer）

- 新增免责声明：插件均来自第三方 GitHub 仓库，与 DSH 插件市场无关，市场不作任何担保，安装风险自担 / Disclaimer added: plugins come from third-party repos, not affiliated with the marketplace; AS-IS, no warranty
- 免责声明同步展示在市场页面底部（中英双语）/ disclaimer also shown at the bottom of the marketplace page (bilingual)

---

## v0.6.0-beta — 2026-08-13（静态索引与规模扩展 / Static registry & scaling）

- **registry.json 静态索引**：插件列表优先从 CDN（jsDelivr）加载，零 GitHub API 调用、零限流 / static `registry.json` served via CDN — zero API calls, zero rate limits
- **GitHub Actions 自动重建**：每 2 小时生成并提交索引（当前收录 450+ 插件）/ CI rebuilds the registry every 2 hours (450+ plugins indexed)
- **搜索 API 兜底**：索引不可用时自动回退 / search-API fallback when the registry is unreachable
- **手动立即更新**：`update-registry.ps1 / .sh / .bat` 随时触发重建，无需等定时 / manual refresh scripts trigger an immediate rebuild
- **兜底搜索支持 GH_TOKEN**，上限提升至 5000 仓库 / fallback search honors GH_TOKEN, cap raised to 5000 repos

---

## v0.5.0-beta — 2026-08-13（一键安装 / Quick install）

- 仓库内置 `install.ps1` / `install.sh` 自安装脚本（支持直接运行、`irm | iex`、被市场执行三种模式）/ self-install scripts (`install.ps1` / `install.sh`) with three run modes
- README 新增「一键安装」：一条命令或一句话交给 AI 即可安装 / one-command or hand-it-to-an-AI install

---

## v0.4.0-beta — 2026-08-13（UI 修复 / UI fixes）

- **修复 busy 标志全局化**：一个安装进行中时所有按钮一起变「安装中...」→ 现在只有正在安装的仓库显示 / fixed global busy flag — only the installing repo shows «Installing...»
- **过期响应守卫**：并发安装时旧请求不再覆盖新面板 / stale install responses no longer clobber the active panel

---

## v0.3.0-beta — 2026-08-13（中英双语 / Bilingual）

- 界面与安装日志接入 DSH locale 服务，跟随 设置 → 常规 → Language 切换 / UI and install logs follow DSH's language setting (Settings → General → Language)
- 修复 locale 接入方式：改用官方 `inject: ["slots", "locale"]` 注入，DSH 设英文后界面正确切换 / switched to the official locale injection pattern
- README 中英双版（`README.md` / `README.en.md`）与切换横幅 / bilingual READMEs with a language switcher

---

## v0.2.0-beta — 2026-08-13（已安装识别强化 / Installed detection）

- **四重判定**：安装清单 + 目录启发式（含原始仓库名）+ 包名映射扫描 + 本体 `repository` 自识别 / four-way detection: manifest + directory heuristics + package-name mapping + self-identification
- 修复仓库名与包名不一致时误判（如 `DSH-Plugins-Marketplace` → `dsh-plugin-marketplace`）/ repos whose name differs from the package name are now recognized
- 已装版本号正确读出 / installed versions read correctly

---

## v0.1.0-beta — 2026-08-13（首个可用版本 / First usable version）

- 从 GitHub `topic:dsh-plugin` 分页拉取全部插件，按 Star 排序，10 分钟缓存 / pages all `topic:dsh-plugin` repos, sorted by stars, 10-min cache
- 一键安装：自动识别 skill / agent 预设 / cordis 插件 / 安装脚本四类 / one-click install with automatic type detection (skill / agent preset / cordis plugin / install script)
- 环境变量材料介入（安装暂停等待用户提供，可跳过）/ env-var input interception (pauses install for user material, skippable)
- 脚本执行确认（安全提示）/ third-party script confirmation dialog
- 版本检测与「更新」按钮 / version detection and «Update» button
- 搜索 / 刷新反馈 / GitHub 原链 / 深浅色适配 / search, refresh feedback, GitHub links, dark/light themes
