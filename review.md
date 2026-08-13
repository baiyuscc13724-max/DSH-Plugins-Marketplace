# DSH-Plugins-Marketplace 代码审查报告

- 审查日期：2026-08（基于仓库当前工作区快照，HEAD `20aa524`）
- 审查范围：`lib/index.js`（服务端）、`lib/client.js`（客户端）、`scripts/build-registry.mjs`、`install.ps1` / `install.sh`、`update-registry.ps1` / `.sh` / `.bat`、`.github/workflows/registry.yml`、`package.json`、`README.md`
- 审查维度：安全性、正确性、性能、可维护性、风格一致性、文档一致性

> 背景：这是一个"从 GitHub 安装第三方插件"的市场，第三方代码在用户机器上执行是其设计前提（README 已有免责声明）。以下问题聚焦于**超出该设计前提之外**、可被恶意利用或意外触发的缺陷。

---

## 一、Critical（严重，建议立即修复）

### C1. 安装端点无 CSRF / Origin 校验，"脚本执行确认"可被伪造绕过
`lib/index.js:524-610`（端点注册）、`lib/index.js:565-585`（确认逻辑）

- **问题**：`/api/marketplace/install` 是无需任何认证的状态变更端点。DSH web 绑定在 `127.0.0.1`，但浏览器跨域仍能**发出**请求（只是读不到响应）。服务端既未校验 `Origin`/`Referer`，也未要求任何自定义头或 token。攻击者的恶意网页可以用 `fetch("http://127.0.0.1:3080/api/marketplace/install", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ repo: "evil/repo", answers: { "__confirm_script__": "continue" } }) })` 发起"简单请求"（`text/plain` 不触发 preflight），而 `readJsonBody`（`lib/index.js:289-294`）不校验 Content-Type，照样解析 JSON。
- **后果**：受害者只要访问恶意网页，其本机就会被静默诱导 `git clone` 任意仓库并**执行其中的 install.sh/install.ps1（脚本类型）或 npm 依赖的 install 脚本（cordis 类型）**。用户界面上的"确认执行第三方脚本"（`lib/index.js:565`）完全依赖客户端提交的 `answers.__confirm_script__`，服务端无法区分用户真实点击与攻击者伪造。这构成对设计安全模型的完整绕过。
- **修复建议**：
  1. 校验 `Origin`/`Referer` 头，仅放行 DSH web 自身 origin（`http://127.0.0.1:*` / `http://localhost:*`，与 `Host` 头一致，可防 DNS rebinding）；
  2. 要求自定义头（如 `X-DSH-Client: marketplace`，非 CORS 安全头会强制 preflight，跨站攻击者无法携带）；
  3. 理想方案：由 DSH 注入一次性 CSRF token 并校验。

### C2. cordis 插件 `pkg.name` 未校验 → 任意目录删除 / 任意位置写入 / YAML 注入
`lib/index.js:655`（`pkgName = pkg.name`）、`lib/index.js:663-667`（`join` + `rm -rf` + `cp`）、`lib/index.js:675`（patch 行模板）

- **问题**：`installRepo` 的 cordis-plugin 分支直接把仓库 `package.json` 的 `name` 字段拼进目标路径 `dest = join(PROFILE_NM, pkgName)`。该字段完全由第三方仓库控制且**未做任何校验**（skill 分支的 frontmatter name 有正则白名单 `lib/index.js:620`，这里没有）。若仓库的 `dependencies` 为空（`lib/index.js:658` 跳过 npm install），`pkgName = "../../../../../..."` 时：
  - `rm(dest, { recursive: true, force: true })`（`lib/index.js:665`）会**递归删除任意目录**（如用户主目录、甚至权限允许时的更深路径）；
  - `cp(cacheDir, dest)`（`lib/index.js:667`）会把攻击者内容写入任意位置。
- 同时 `lib/index.js:675` 的 `row` 模板把 `pkgName` 原样嵌入 YAML 写入 `cordis.patch.yml`——`pkg.name` 可含换行，构成 YAML 结构注入（可注入任意插件加载条目）。
- **修复建议**：
  1. 用 npm 包名白名单正则校验 `pkg.name`（如 `^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$`），不合法则拒绝安装；
  2. 双保险：`const dest = join(PROFILE_NM, pkgName)` 后校验 `path.resolve(dest)` 仍以 `path.resolve(PROFILE_NM)` 为前缀，否则拒绝；
  3. 写入 patch 的 `pkgName` 同样先经过上述校验（YAML 值最好再加单引号转义）。

---

## 二、Major（重要，应尽快修复）

### M1. `answers` 键无白名单，直接展开进子进程环境（环境变量劫持 + 敏感变量全量泄露）
`lib/index.js:614`（`const env = { ...process.env, ...answers }`）

- **问题**：客户端提交的 `answers` 对象键完全未过滤，被展开进传给第三方脚本 / npm 的环境。后果有二：
  1. 攻击者（配合 C1 或任何本地调用方）可覆盖 `PATH`、`HOME`、`NPM_CONFIG_*` 等键。例如把 `PATH` 指向缓存目录并在仓库中放置名为 `npm` 的可执行文件（POSIX 上 `execFileAsync("npm")` 按 `env.PATH` 解析），即可劫持 npm 调用为任意代码执行，且**无需通过脚本类型确认**（cordis 类型无确认步骤）。
  2. 正常流程中，**全部 `process.env`（含用户可能存在的 `GH_TOKEN`、`DEEPSEEK_API_KEY` 等）被传递给第三方 install 脚本**，泄露面远大于用户明确填写的值。
- **修复建议**：服务端在提交确认后重新运行 `scanRequirements` 得到合法变量名单，`env` 只取 `{ ...process.env 中必要的白名单子集, ...仅来自该名单的 answers }`；对第三方脚本至少剔除 `*_TOKEN` / `*_KEY` 类敏感变量。`__confirm_script__` 单独处理，不进 env。

### M2. cordis 类型自动执行第三方依赖的 install 脚本，无用户确认
`lib/index.js:431-435`（第一次尝试无 `--ignore-scripts`）、`lib/index.js:658-660`（调用处）

- **问题**：npm install 回退链的第一步（`--omit=dev --no-audit --no-fund`）会运行仓库 `package.json` 的 `prepare` 脚本及其依赖的 pre/install/postinstall 脚本——即执行第三方任意代码。脚本类型插件有明确的用户确认（`lib/index.js:565`），但 cordis 类型安装只需点一次"安装"就自动执行 npm 脚本，保护强度不一致，且 UI 文案（`t("install")`）不会让用户意识到代码正在执行。
- **修复建议**：对 cordis 类型也增加确认步骤（提示"安装将执行第三方 npm 依赖脚本"）；或默认第一步就带 `--ignore-scripts`，仅在用户确认后去掉该旗标。

### M3. 客户端未校验外链协议，存在 `javascript:` URL XSS 向量
`lib/client.js:170`（`href: repo.html_url`）、`lib/index.js:326`（`html_url` 原样透传）

- **问题**：`RepoCard` 直接以 `repo.html_url` 作为 `<a href>`。React 会原样设置 href 且不阻止 `javascript:` 协议（仅 dev 警告）。数据源 `registry.json` 由本仓库 main 分支内容决定（jsDelivr 提供），若 GitHub 账户或 CI 被攻破、或仓库被投毒，可注入 `javascript:...` URL——用户点击即在 DSH web 页面上下文执行任意 JS（该上下文可调用全部本地 API，含 C1 的安装端点），形成攻击链。
- **修复建议**：渲染前校验 `html_url` 协议为 `http:`/`https:` 且 host 为 `github.com`（在 `normalizeRepo` 或客户端渲染时）；不合法则丢弃链接。

### M4. 同一仓库并发安装无互斥（rm / clone / patch 写竞态）
`lib/index.js:539-543`（rm + clone）、`lib/index.js:664-679`（patch 读-改-写）

- **问题**：安装端点无 per-repo 锁。两个并发安装同一仓库时，`rm(cacheDir)` 与正在进行的 clone/cp 冲突；两个 cordis 安装并发时 `readFile(PATCH_FILE)` → 修改 → `writeFile` 是非原子读-改-写，可能丢失对方条目或写出损坏的 YAML。客户端虽有"过期响应丢弃"（`lib/client.js:306-308`），但那是 UI 层，服务端状态仍可能被破坏。
- **修复建议**：按 `repo` 维护一个 `Map<string, Promise>` 互斥（重复请求直接复用/拒绝）；patch 写入用临时文件 + 原子 rename，或对 patch 读写加互斥。

### M5. 请求体无大小限制（内存耗尽型 DoS）
`lib/index.js:289-294`

- **问题**：`readJsonBody` 用字符串拼接累积 chunk，无任何长度上限。本地或局域网可达方（见 C1）可发送超大 body 耗尽 Node 进程内存。
- **修复建议**：累积字节数超限（如 1 MB）即终止请求返回 413。

### M6. 已注册判定用子串匹配，前缀包名会误判跳过注册
`lib/index.js:671`（`patch.includes("name: " + pkgName)`）、`install.ps1:42`（`Select-String "name: dsh-plugin-marketplace"`）、`install.sh:37`（`grep -q "name: dsh-plugin-marketplace"`）

- **问题**：`pkgName = "dsh"` 会匹配 `name: dsh-plugin-marketplace` 等任何前缀相同条目，导致误判"已注册"而跳过注册，插件静默加载失败；反之 `dsh-plugin-marketplace-extra` 也会命中本体的注册检查。三个文件的匹配逻辑同样问题。
- **修复建议**：改用行级精确匹配（按行解析 YAML 或正则 `^(\s*)name:\s+<pkg>\s*$`，`grep -qx` 或 `Select-String -Pattern "^name: <pkg>\s*$"`）。

---

## 三、Minor（一般问题）

- **m1. API key 输入框为明文** — `lib/client.js:218-224`：环境变量（API Key 类密钥）输入框 `type: "text"`，旁人可直视屏幕窃取；建议 `type: "password"`。
- **m2. 列表端点串行扫描全部仓库** — `lib/index.js:496-516`：对 491 个仓库逐个 `await detectInstalled` + `readPackageVersion`（每仓库多次 stat/readFile），冷缓存首屏可达秒级；可 `Promise.all` 并行并限制并发。
- **m3. 客户端全量渲染无分页/虚拟列表** — `lib/client.js:355-371`：491 个 RepoCard 一次性渲染（搜索无 debounce），低配机器可感知卡顿。
- **m4. 兜底搜索路径不支持 GH_TOKEN** — `lib/index.js:296-302, 359-375`：`fetchSearchRepos` 未读环境变量带 `Authorization` 头，未认证限流 10 次/分钟（README 已提示，但本可低成本改善）；`MAX_PAGES=10`（`lib/index.js:22`）与 CI 侧 100 页不一致，超 1000 仓库时兜底列表截断。
- **m5. 敏感环境变量检测模式过窄** — `lib/index.js:24`：`ENV_PATTERN` 只匹配全大写 + 特定后缀（`API_KEY`/`_TOKEN` 等），`apiKey`、`GEMINI_KEY` 之外形态的密钥检测不到；且 `_PASS` 会误伤 `BY_PASS` 等词。建议同时匹配 camelCase 形态并收紧边界。
- **m6. skill 分支复制含 `.git`，且过滤是子串匹配** — `lib/index.js:626`：skill 复制不排除 `.git`（cordis 分支排除了，不一致），白白复制数百 MB 的 git 对象；`src.includes(join(cacheDir, "node_modules"))`（`lib/index.js:626,667`）会误伤名为 `node_modules_backup` 的目录。
- **m7. 自举安装脚本把 `.ca-bundle.crt` 一并复制到用户目录** — `install.ps1:33`、`install.sh:31`：`Copy-Item $src $dest -Recurse` / `cp -r` 会把仓库内 231KB 的 CA 证书包（注释自述为"SteamTools/代理 MITM 信任锚"）复制进 `~/.dsh/profiles/web/node_modules/dsh-plugin-marketplace/`。该文件已 gitignore 且未跟踪（已核验），但本地存在时会被拷贝；建议在安装脚本中显式排除。
- **m8. CI 频率接近 Actions 免费额度** — `.github/workflows/registry.yml:6`：每 2 小时一次，约 360 次/月 × ~4.5 分钟 ≈ 1600 分钟/月，逼近公共仓库 2000 分钟/月限额；建议改为每 4-6 小时并观察。
- **m9. partial-merge 不清理已消失的仓库** — `scripts/build-registry.mjs:96-102`：中途失败时旧条目永久保留，取消防患（topic 移除的仓库仍长期出现在市场列表）；可给旧条目打时间戳并超过 N 天剔除。
- **m10. 版本比较是字符串比较** — `lib/index.js:509`：`installedVersion !== latestVersion` 对 `1.0.0` vs `1.0.0-rc.1` 等语义版本判断错误；建议引入 `semver.compare`（或至少 normalize 后比较）。
- **m11. 无任何自动化测试与 lint 配置** — 全仓库无 test 目录、无 CI 测试 job、无 eslint 配置；`lib/index.js` 含大量安全敏感的路径与子进程逻辑，重构风险高。建议至少为 `detectType`/`installRepo`/`readJsonBody`/repo 校验补单元测试，并给 workflow 加 `node --check` 步骤。
- **m12. 一次命令安装模式无完整性校验** — `install.ps1:6`、`install.sh:6`：`irm | iex` / `curl | bash` 是公认的远程代码执行模式，README 推荐此方式但未提示风险（如传输被劫持）。至少在文档中建议"下载后先肉眼检查再执行"。

---

## 四、Nit（细微问题）

- **n1. 405 响应文案硬编码英文，未走 i18n** — `lib/index.js:490,528`：`json(res, 405, { error: "method not allowed" })` 未用 `t(lang, "methodNotAllowed")`（文案键已存在，见 `lib/index.js:213,256`）。
- **n2. 安装脚本注册 id 与运行时不一致** — `install.ps1:45`、`install.sh:40` 硬编码 `id: plugin-marketplace`，而 `lib/index.js:670` 用 `slugify(pkgName)` 生成 `id: dsh-plugin-marketplace`。当前无害（先装本体后不会再被市场安装），但两套 id 并存容易混淆。
- **n3. `package.json` 导出浏览器 bundle 为 Node 入口** — `package.json:9`：`"./client": "./lib/client.js"`，而该文件第一行即 `window.__ModuleLoader__.load(...)`，Node 中 `import` 会抛 `ReferenceError`；建议移除该导出或注明仅限浏览器 loader 使用。
- **n4. 0 star 仓库显示"新仓库"** — `lib/client.js:168`：`stargazers_count > 0` 为假（含 0 star 老仓库）就显示 `badgeNew`，语义不准。
- **n5. 日志列表用数组下标作 React key** — `lib/client.js:194,236`：`key: i`，追加日志时无实际问题，但按 React 规范应使用稳定 key。
- **n6. 顶部 await 的模块级副作用** — `lib/index.js:165`：`await loadInstalled()` 使模块导入被磁盘 IO 阻塞；当前可接受，但建议改为 `apply()` 内显式初始化，便于测试。
- **n7. README 未记录安全模型** — README 的免责声明完整（已核验），但建议在"已知限制"（`README.md:172`）补充：安装端点无认证、依赖本地网络隔离，以及"安装 = 在用户机器上执行第三方代码"的显式说明。

---

## 五、已验证无问题（Verified OK）

- ✅ **git URL 注入防护**：`repo` 经 `^[\w.-]+\/[\w.-]+$` 白名单校验（`lib/index.js:533`）且 clone URL 固定 `https://github.com/` 前缀，无法注入 `--upload-pack` 之外的参数（参数化调用，无 shell）。
- ✅ **缓存目录路径安全**：`cacheDir` 由 `slugify(owner)__slugify(repoName)` 构成（`lib/index.js:539`），`slugify` 输出仅 `[a-z0-9-]`，不含 `..` 或分隔符。
- ✅ **skill frontmatter 名称白名单**：`/^name:\s*"?([a-z0-9][a-z0-9-]*)"?$/m`（`lib/index.js:620`）无法路径穿越。
- ✅ **无 shell 命令注入面**：全部子进程调用使用 `execFile`/`execFileAsync`（非 `exec`/shell 字符串），参数为数组。
- ✅ **客户端 XSS 防护**：所有外部数据（描述、话题、日志、错误）经 React `createElement` 渲染（自动转义），全文未发现 `innerHTML` / `dangerouslySetInnerHTML` / `eval`。
- ✅ **外链 `rel="noopener noreferrer"`**：`lib/client.js:170`，防 tabnabbing。
- ✅ **`.ca-bundle.crt` 未被提交**：`git ls-files` 核验不在版本库中，`.gitignore:14` 已忽略。
- ✅ **CI 供应链面收敛**：workflow 仅在 `schedule` / `workflow_dispatch` 触发（`.github/workflows/registry.yml:3-7`），fork PR 无法注入代码运行；`GITHUB_TOKEN` 推送不会触发新 workflow（无循环）。
- ✅ **客户端安装面板竞态防护**：过期响应按 `prev.repo !== repo` 丢弃（`lib/client.js:306-308`），避免旧日志覆盖新面板。
- ✅ **失败安装清理**：catch 分支删除缓存克隆（`lib/index.js:605`），配合 `detectInstalled` 不再把失败缓存当作已安装（`lib/index.js:154-158`）。
- ✅ **README 与实现一致性**：缓存 10 分钟、脚本类"已安装"判定基于缓存目录、版本检测仅限含 `package.json` 的插件、限流提示等"已知限制"与代码行为相符（`README.md:172-177`）。
- ✅ **registry 构建脚本限流与增量合并逻辑**：带 token 2.2s / 未认证 6.5s 延迟（`scripts/build-registry.mjs:25`），失败走 partial-merge 保留旧数据，行为正确（m9 属策略取舍）。

---

## 六、总结

| 级别 | 数量 | 核心结论 |
|---|---|---|
| Critical | 2 | C1（CSRF + 确认绕过，可远程静默装恶意仓库）、C2（`pkg.name` 路径穿越，可删任意目录/写任意位置） |
| Major | 6 | M1（env 键注入与全量泄露）、M2（cordis 安装静默执行 npm 脚本）、M3（`javascript:` URL）、M4（并发竞态）、M5（body 无上限）、M6（子串误判） |
| Minor | 12 | 输入框明文、串行扫描、全量渲染、限流、检测模式、CI 额度等 |
| Nit | 7 | i18n 遗漏、id 不一致、exports 误导等 |

**优先修复顺序建议**：C1 → C2 → M1 → M2 → M3 → M4。其中 C1 与 C2 均为可在受害者无感知情况下造成实际破坏的漏洞（任意代码执行 / 任意目录删除），建议在发布任何更新前先修复。修复 C1、C2、M1 后，本项目的安全模型即可与其 README 免责声明中"用户知情后自担风险"的定位相符。
