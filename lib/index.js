import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, cp, readFile, writeFile, stat, readdir, rename } from "node:fs/promises";
import { join, dirname, resolve, sep } from "node:path";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);

export const name = "dsh-plugin-marketplace";

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), ".dsh");
const MARKET_ROOT = join(DSH_HOME, "marketplace");
const CACHE_DIR = join(MARKET_ROOT, "cache");
const SKILLS_DIR = join(DSH_HOME, "skills");
const PRESETS_DIR = join(DSH_HOME, ".agent-presets");
const PROFILE_WEB_DIR = join(DSH_HOME, "profiles", "web");
const PROFILE_NM = join(PROFILE_WEB_DIR, "node_modules");
const PATCH_FILE = join(PROFILE_WEB_DIR, "cordis.patch.yml");

const SEARCH_QUERY = "topic:dsh-plugin";
const PAGE_SIZE = 100;
/** 兜底搜索 API 最大翻页数（带 token 时可全量翻到底，超 1000 个仓库也不会截断）。 */
const MAX_PAGES = 50;
const CACHE_TTL_MS = 10 * 60 * 1000;
/** 环境变量检测：覆盖全大写后缀与 camelCase 形态；_PASS 需要前文至少 3 个字符，避免误伤 BY_PASS 等词。 */
const ENV_PATTERN = /\b(?:[A-Z][A-Z0-9_]{1,}(?:API_KEY|_KEY|_TOKEN|_SECRET|_PASSWORD)|[A-Z][A-Z0-9_]{3,}_PASS|[a-z][A-Za-z0-9]*(?:ApiKey|Key|Token|Secret|Password|Pass))\b/g;
const INSTALLED_FILE = join(MARKET_ROOT, "installed.json");
/** 请求体大小上限（防内存耗尽型 DoS）。 */
const MAX_BODY_BYTES = 1024 * 1024;
/** 防 CSRF 的自定义头（跨站请求无法携带，强制 preflight）。 */
const CSRF_HEADER = "x-dsh-marketplace";
/** npm 包名白名单（npm 官方命名规则，含 scoped）。 */
const PKG_NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
/** 安装互斥：repo -> Promise，同一仓库并发安装直接拒绝。 */
const installLocks = new Map();
/** patch 写队列：不同仓库并发安装时串行化读-改-写。 */
let patchQueue = Promise.resolve();

let listCache = { at: 0, repos: null };
let listFetching = null;
/** full_name -> { type, name, location, installedAt } */
const installedMap = new Map();

/** 启动时加载已安装清单（文件不存在时为空）。 */
async function loadInstalled() {
  try {
    const text = await readFile(INSTALLED_FILE, "utf8");
    const data = JSON.parse(text);
    if (data && typeof data === "object") {
      for (const [key, value] of Object.entries(data)) installedMap.set(key, value);
    }
  } catch { /* 首次运行：无清单文件 */ }
}

/** 持久化一条安装记录（先写盘成功再入内存，避免持久化失败留下脏的已安装判定）。 */
async function saveInstalled(fullName, record) {
  const data = {};
  for (const [key, value] of installedMap) data[key] = value;
  data[fullName] = record;
  await mkdir(MARKET_ROOT, { recursive: true });
  await writeFile(INSTALLED_FILE, JSON.stringify(data, null, 2), "utf8");
  installedMap.set(fullName, record);
  profileScanCache = null; // 新安装会新增目录，下次扫描重新建立映射
}

const pathExists = (p) => stat(p).then(() => true).catch(() => false);

/** 读取目录下 package.json 的 version 字段；文件缺失或解析失败返回 null。 */
async function readPackageVersion(dir) {
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : null;
  } catch {
    return null;
  }
}

/** 读取目录下 package.json 的 name 字段；文件缺失或解析失败返回 null。 */
async function readPackageName(dir) {
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    return typeof pkg.name === "string" && pkg.name.length > 0 ? pkg.name : null;
  } catch {
    return null;
  }
}

/**
 * 本插件自己的 GitHub 仓库（来自 package.json 的 repository 字段，小写）。
 * 仓库名与包名不一致时（如 DSH-Plugins-Marketplace → dsh-plugin-marketplace），
 * 目录启发式无法把本体识别为已安装，这里直接按 repository 字段命中。
 */
let ownRepo = null;
async function loadOwnRepo() {
  if (ownRepo !== null) return ownRepo;
  try {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    ownRepo = typeof url === "string"
      ? url.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").toLowerCase() || null
      : null;
  } catch {
    ownRepo = null;
  }
  return ownRepo;
}

/**
 * 扫描已安装目录（web profile 的 node_modules / skills / 预设），
 * 建立「目录名或包名(小写) -> { name, version }」映射，用于识别
 * 仓库名与包名不一致的安装（如仓库 DSH-Plugins-Marketplace，包名 dsh-plugin-marketplace）。
 */
let profileScanCache = null;
async function scanProfilePackages() {
  if (profileScanCache) return profileScanCache;
  const map = new Map();
  const add = (key, name, version) => {
    if (!key) return;
    const existing = map.get(key);
    if (!existing || (existing.version == null && version != null)) {
      map.set(key, { name: name ?? null, version: version ?? null });
    }
  };
  for (const [dir, readPkg] of [[PROFILE_NM, true], [SKILLS_DIR, false], [PRESETS_DIR, false]]) {
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      add(entry.name.toLowerCase(), null, null);
      if (readPkg) {
        let pkg = {};
        try { pkg = JSON.parse(await readFile(join(dir, entry.name, "package.json"), "utf8")); } catch { /* 忽略缺失或损坏的 package.json */ }
        add(String(pkg.name ?? "").toLowerCase(), pkg.name ?? null, typeof pkg.version === "string" ? pkg.version : null);
      }
    }
  }
  profileScanCache = map;
  return map;
}

/**
 * 检测仓库是否已安装，四重判定：
 * 1. 安装清单（installed.json，本插件安装过的）
 * 2. 目录启发式：skills / 预设 / node_modules（含原始仓库名）/ 市场缓存克隆
 * 3. 包名映射：扫描已安装目录的 package.json 名称，与仓库名/缓存包名比对
 * 4. 本体识别：仓库命中本插件自身 repository 字段
 */
async function detectInstalled(repo) {
  if (installedMap.has(repo.full_name)) return true;
  const slug = slugify(repo.name);
  const owner = slugify(String(repo.full_name).split("/")[0] ?? "");
  const cacheDir = join(CACHE_DIR, `${owner}__${slug}`);
  const candidates = [
    join(SKILLS_DIR, slug),
    join(PRESETS_DIR, slug),
    join(PROFILE_NM, slug),
    join(PROFILE_NM, repo.name)
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return true;
  }
  const self = await loadOwnRepo();
  if (self && String(repo.full_name).toLowerCase() === self) return true;
  const profile = await scanProfilePackages();
  if (profile.has(slug) || profile.has(String(repo.name).toLowerCase())) return true;
  // 缓存克隆存在 ≠ 安装成功（失败的安装也会留下缓存）。
  // 仅脚本类插件以缓存目录作为安装成果（见 README 已知限制），其余类型按上面的真实安装目录判定。
  if (await pathExists(cacheDir)) {
    const cacheType = await detectType(cacheDir);
    if (cacheType === "script") return true;
  }
  const pkgName = await readPackageName(cacheDir);
  if (pkgName && profile.has(pkgName.toLowerCase())) return true;
  return false;
}

await loadInstalled();

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "plugin";
}

/** 服务端文案字典（zh / en）。 */
const MESSAGES = {
  zh: {
    "step1": "[1/5] 克隆 https://github.com/{repo} ...",
    "cloneDone": "克隆完成。",
    "step2": "[2/5] 识别安装类型: {type}",
    "type.skill": "skill",
    "type.agent-preset": "agent 预设",
    "type.script": "安装脚本",
    "type.cordis-plugin": "cordis 插件",
    "type.instructions": "手动安装（README 说明）",
    "step3": "[3/5] 扫描所需环境变量: {list}",
    "none": "无",
    "awaiting": "需要用户提供材料，安装已暂停。",
    "qEnvHeader": "{repo} 需要 {v}",
    "qEnv": "该插件需要环境变量 {v}（通常是 API Key 等密钥）。请提供其值以继续安装（空值可跳过）：",
    "scriptDetected": "检测到安装脚本，需要用户确认。",
    "qScriptHeader": "确认执行第三方脚本",
    "qScript": "仓库 {repo} 包含安装脚本（install.sh / install.ps1），安装将执行该脚本。下载并运行第三方代码存在安全风险，是否继续？",
    "optContinue": "继续安装",
    "optContinueDesc": "信任该仓库并执行其安装脚本",
    "optCancel": "取消安装",
    "optCancelDesc": "不执行任何脚本",
    "scriptCancelled": "用户取消安装脚本执行。",
    "step4": "[4/5] 开始安装 ...",
    "step5": "[5/5] 完成。",
    "fail": "安装失败: {err}",
    "skillInstalled": "skill「{name}」已安装到 {dest}，技能注册器将自动热加载。",
    "presetInstalled": "agent 预设「{name}」已安装到 {dest}。",
    "runPs1": "正在执行 install.ps1 ...",
    "runSh": "正在执行 install.sh (bash) ...",
    "scriptDone": "安装脚本执行完成。仓库保留在 {dir}",
    "deps": "正在安装依赖 (npm install --omit=dev)，共 {n} 项 ...",
    "depsDone": "依赖安装完成。",
    "npmFallbackPeers": "常规安装遇 peer 冲突，已改用 --legacy-peer-deps 重试（peer 依赖由 DSH 宿主提供）。",
    "npmFallbackScripts": "依赖安装脚本不可用，已改用 --ignore-scripts 重试（使用仓库已提交的构建产物）。",
    "npmScriptsDetected": "检测到第三方 npm 生命周期脚本（{scripts}），需要确认。",
    "qNpmScriptsHeader": "确认执行第三方 npm 脚本",
    "qNpmScripts": "仓库 {repo} 的 package.json 包含生命周期脚本：{scripts}。npm 安装依赖时会执行这些脚本，即运行第三方代码。是否允许执行？选择「不允许」将取消安装并清理所有痕迹。",
    "optAllow": "允许执行",
    "optAllowDesc": "信任该仓库，安装时执行其 npm 生命周期脚本",
    "optDeny": "不允许（取消安装）",
    "optDenyDesc": "不执行任何脚本，取消安装并清理痕迹",
    "npmScriptsDenied": "用户不允许执行第三方 npm 脚本，安装已取消，已清理全部痕迹。",
    "npmScriptsAllowed": "已允许执行第三方 npm 生命周期脚本。",
    "copied": "插件包已复制到 {dest}",
    "patchExists": "profile 补丁中已存在该插件条目，跳过注册。",
    "patchDone": "已注册到 web profile 补丁 (id: {id})。加载器热重载后生效；若未生效请重启 dsh web 并刷新页面。",
    "instructions": "该仓库不含可自动安装的 SKILL.md / agent 预设 / 安装脚本 / 插件清单，请按 README 手动安装：",
    "noReadme": "（无 README）",
    "badRepo": "repo 参数格式应为 owner/name",
    "methodNotAllowed": "method not allowed",
    "listFail": "拉取失败: {err}"
  },
  en: {
    "step1": "[1/5] Cloning https://github.com/{repo} ...",
    "cloneDone": "Clone complete.",
    "step2": "[2/5] Install type: {type}",
    "type.skill": "skill",
    "type.agent-preset": "agent preset",
    "type.script": "install script",
    "type.cordis-plugin": "cordis plugin",
    "type.instructions": "manual install (README instructions)",
    "step3": "[3/5] Required env vars: {list}",
    "none": "none",
    "awaiting": "Input required — install paused.",
    "qEnvHeader": "{repo} requires {v}",
    "qEnv": "This plugin needs env var {v} (usually an API key or secret). Provide its value to continue (leave empty to skip):",
    "scriptDetected": "Install script detected — confirmation required.",
    "qScriptHeader": "Confirm running a third-party script",
    "qScript": "Repo {repo} contains an install script (install.sh / install.ps1) that will be executed. Downloading and running third-party code is risky. Continue?",
    "optContinue": "Continue install",
    "optContinueDesc": "Trust this repo and run its install script",
    "optCancel": "Cancel install",
    "optCancelDesc": "Do not run any script",
    "scriptCancelled": "Script execution cancelled by user.",
    "step4": "[4/5] Installing ...",
    "step5": "[5/5] Done.",
    "fail": "Install failed: {err}",
    "skillInstalled": "Skill \"{name}\" installed to {dest}; the skill registry will hot-reload it.",
    "presetInstalled": "Agent preset \"{name}\" installed to {dest}.",
    "runPs1": "Running install.ps1 ...",
    "runSh": "Running install.sh (bash) ...",
    "scriptDone": "Install script finished. Repo kept at {dir}",
    "deps": "Installing dependencies (npm install --omit=dev), {n} packages ...",
    "depsDone": "Dependencies installed.",
    "npmFallbackPeers": "Peer conflict on plain install — retrying with --legacy-peer-deps (peers are provided by the DSH host).",
    "npmFallbackScripts": "Install scripts unavailable — retrying with --ignore-scripts (using the build artifacts committed in the repo).",
    "npmScriptsDetected": "Third-party npm lifecycle scripts detected ({scripts}) — confirmation required.",
    "qNpmScriptsHeader": "Confirm running third-party npm scripts",
    "qNpmScripts": "Repo {repo} has lifecycle scripts in package.json: {scripts}. npm will run these scripts while installing dependencies — that executes third-party code. Allow it? Choosing «No» cancels the install and cleans up all traces.",
    "optAllow": "Allow",
    "optAllowDesc": "Trust this repo and run its npm lifecycle scripts during install",
    "optDeny": "Deny (cancel install)",
    "optDenyDesc": "Do not run any scripts; cancel the install and clean up",
    "npmScriptsDenied": "User denied third-party npm scripts — install cancelled, all traces cleaned up.",
    "npmScriptsAllowed": "Third-party npm lifecycle scripts allowed.",
    "copied": "Plugin package copied to {dest}",
    "patchExists": "Profile patch already has this plugin entry — skipping registration.",
    "patchDone": "Registered in the web profile patch (id: {id}). Takes effect after the loader hot-reloads; otherwise restart dsh web and refresh the page.",
    "instructions": "This repo has no auto-installable SKILL.md / agent preset / install script / plugin manifest. Install manually per its README:",
    "noReadme": "(no README)",
    "badRepo": "repo must be in owner/name format",
    "methodNotAllowed": "method not allowed",
    "listFail": "Fetch failed: {err}"
  }
};

/** 按语言取文案并做 {var} 插值；未知键回退中文再回退键名。 */
function t(lang, key, vars) {
  const dict = lang === "en" ? MESSAGES.en : MESSAGES.zh;
  let s = dict[key] ?? MESSAGES.zh[key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) s = s.split("{" + k + "}").join(String(vars[k]));
  }
  return s;
}

/** 解析请求语言：优先 body.lang，其次 Accept-Language 头；仅区分 zh / en，未知默认 zh。 */
function langOf(req, body) {
  const raw = (body && typeof body.lang === "string" && body.lang)
    || (req?.headers?.["accept-language"]) || "";
  const primary = String(raw).split(",")[0].trim().toLowerCase().split("-")[0];
  return primary === "en" ? "en" : "zh";
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

async function readJsonBody(req) {
  let raw = "";
  let size = 0;
  for await (const chunk of req) {
    raw += chunk;
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY_BYTES) {
      const error = new Error("request body too large");
      error.status = 413;
      throw error;
    }
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

/**
 * 防 CSRF / DNS rebinding：
 * - 要求自定义头 X-DSH-Marketplace: 1（跨站简单请求无法携带，会强制 preflight 被 CORS 拦下）；
 * - 若带 Origin 头，必须与请求自身的 Host 一致（127.0.0.1/localhost 或局域网地址均可，
 *   但攻击者域名无法伪造 Host）。
 */
function isTrustedRequest(req) {
  if (req.headers[CSRF_HEADER] !== "1") return false;
  const origin = req.headers["origin"];
  if (!origin) return true; // 无 Origin 的非浏览器调用方（本地脚本/curl）放行
  try {
    return new URL(origin).host === String(req.headers["host"] ?? "");
  } catch {
    return false;
  }
}

/** patch 中是否已有该包名的注册条目（行级精确匹配，避免前缀子串误判）。 */
function hasPatchEntry(patchText, pkgName) {
  const pattern = new RegExp("^\\s*name:\\s*" + pkgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "m");
  return pattern.test(patchText);
}

/**
 * 原子追加注册条目到 cordis.patch.yml：读-改-写串行化 + 临时文件 rename。
 * 返回 true 表示本次写入了新条目，false 表示已存在。
 */
async function appendPatchEntry(entryId, pkgName) {
  const task = (async () => {
    const patch = await readFile(PATCH_FILE, "utf8").catch(() => "");
    if (hasPatchEntry(patch, pkgName)) return false;
    const trimmed = patch.trim();
    const row = `    - id: ${entryId}\n      name: ${pkgName}\n`;
    const next = trimmed === "" || trimmed === "[]"
      ? `# dsh-plugin-marketplace 自动注册的插件条目\n- insert:\n${row}`
      : patch.endsWith("\n") ? patch + "- insert:\n" + row : patch + "\n- insert:\n" + row;
    const tmp = PATCH_FILE + ".tmp";
    await writeFile(tmp, next, "utf8");
    await rename(tmp, PATCH_FILE);
    return true;
  })();
  patchQueue = task.catch(() => {});
  return await patchQueue;
}

/** 轻量语义版本比较：v1.2.3-rc.1 < v1.2.3；返回 -1/0/1；无法解析时回退字符串比较。 */
function compareVersions(a, b) {
  const parse = (v) => {
    const m = String(v).trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
    if (!m) return null;
    return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return String(a) === String(b) ? 0 : String(a) < String(b) ? -1 : 1;
  for (const key of ["major", "minor", "patch"]) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1; // 正式版 > 预发布
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

/** 复制过滤器：排除 .git 与目录边界精确的 node_modules（避免误伤 node_modules_backup 之类）。 */
function copyFilter(cacheDir, excludeNodeModules) {
  const nm = join(cacheDir, "node_modules");
  return (src) => {
    if (src === join(cacheDir, ".git") || src.startsWith(join(cacheDir, ".git") + sep)) return false;
    if (excludeNodeModules && (src === nm || src.startsWith(nm + sep))) return false;
    return true;
  };
}

async function fetchJson(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": "dsh-plugin-marketplace", "Accept": "application/vnd.github+json", ...extraHeaders }
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}${(await res.text().catch(() => "")).slice(0, 200)}`);
  return await res.json();
}

/**
 * 硬编码排除名单：deepseek-harness 是 DSH 本体仓库，不属于插件。
 * 按仓库名精确排除（含同名 fork），避免把 Harness 自身当成可安装插件。
 */
const EXCLUDED_REPO_NAMES = new Set(["deepseek-harness"]);

/**
 * 静态索引 registry.json 的候选源（jsDelivr CDN 优先，raw 兜底）。
 * 索引由 GitHub Actions 每日自动生成（scripts/build-registry.mjs），
 * 读取它零 API 调用、零限流，几千个插件也能秒开；全部失败才回退搜索 API。
 */
const REGISTRY_URLS = [
  "https://cdn.jsdelivr.net/gh/bradeGithub/DSH-Plugins-Marketplace@main/registry.json",
  "https://raw.githubusercontent.com/bradeGithub/DSH-Plugins-Marketplace/main/registry.json"
];

/** 归一化仓库元数据（兼容搜索 API 与 registry.json 两种字段形态）；html_url 只放行 https://github.com 链接。 */
function normalizeRepo(r) {
  let htmlUrl = null;
  try {
    const u = new URL(String(r.html_url ?? ""));
    if (u.protocol === "https:" && u.host === "github.com") htmlUrl = u.href;
  } catch { /* 非法 URL 置空，客户端不渲染链接 */ }
  return {
    full_name: r.full_name,
    name: r.name,
    description: r.description,
    html_url: htmlUrl,
    stargazers_count: r.stargazers_count,
    updated_at: r.updated_at,
    default_branch: r.default_branch ?? "main",
    topics: r.topics ?? [],
    license: typeof r.license === "string" ? r.license : (r.license?.spdx_id ?? null)
  };
}

/** 从 registry 索引拉取仓库列表；全部源失败时返回 null（调用方回退搜索 API）。 */
async function fetchRegistryRepos() {
  for (const url of REGISTRY_URLS) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "dsh-plugin-marketplace" } });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data || !Array.isArray(data.repos)) continue;
      const seen = new Set();
      const collected = [];
      for (const r of data.repos) {
        if (!r || typeof r.full_name !== "string") continue;
        if (seen.has(r.full_name)) continue;
        seen.add(r.full_name);
        if (EXCLUDED_REPO_NAMES.has(r.name)) continue;
        collected.push(normalizeRepo(r));
      }
      if (collected.length > 0) return collected;
    } catch { /* 尝试下一个源 */ }
  }
  return null;
}

/** 搜索 API 兜底路径：分页翻到底，最多 MAX_PAGES 页；存在 GH_TOKEN/GITHUB_TOKEN 时带认证提升限流。 */
async function fetchSearchRepos() {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
  const collected = [];
  const seen = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(SEARCH_QUERY)}&sort=updated&order=desc&per_page=${PAGE_SIZE}&page=${page}`;
    const data = await fetchJson(url, token ? { Authorization: `Bearer ${token}` } : {});
    const items = data.items ?? [];
    for (const r of items) {
      if (seen.has(r.full_name)) continue;
      seen.add(r.full_name);
      if (EXCLUDED_REPO_NAMES.has(r.name)) continue;
      collected.push(r);
    }
    if (items.length < PAGE_SIZE) break;
  }
  return collected.map(normalizeRepo);
}

/**
 * 拉取 topic:dsh-plugin 的全部仓库：registry 索引优先（CDN，零限流），
 * 失败回退搜索 API，去重并排除 DSH 本体后按 Star 数从高到低排序。
 */
async function fetchAllRepos() {
  const collected = (await fetchRegistryRepos()) ?? (await fetchSearchRepos());
  collected.sort((a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0));
  return collected;
}

/** 获取列表：缓存有效期内直接返回；并发请求共享同一次拉取；force 时忽略缓存强制刷新。 */
async function getList(force = false) {
  if (!force && listCache.repos !== null && Date.now() - listCache.at <= CACHE_TTL_MS) return listCache.repos;
  if (listFetching === null) {
    listFetching = fetchAllRepos()
      .then((repos) => {
        listCache = { at: Date.now(), repos };
        return repos;
      })
      .finally(() => {
        listFetching = null;
      });
  }
  return await listFetching;
}

const exists = (p) => stat(p).then(() => true).catch(() => false);

/**
 * 启动 npm（跨平台）：
 * - Windows 上 execFile 无法启动 npm 的 .cmd 批处理（spawn npm ENOENT / spawn npm.cmd EINVAL），
 *   直接用 node.exe 运行 npm-cli.js（不依赖 PATH，最稳）；cli 缺失时回退 npm.cmd。
 * - 其他平台直接 npm。
 */
async function runNpm(args, opts) {
  if (process.platform === "win32") {
    const cli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (await exists(cli)) {
      return await execFileAsync(process.execPath, [cli, ...args], opts);
    }
    return await execFileAsync("npm.cmd", args, opts);
  }
  return await execFileAsync("npm", args, opts);
}

/**
 * npm install 回退链：
 * - allowScripts=false（默认，安全）：一律 --ignore-scripts，第三方 npm 脚本不执行；
 *   失败时加 --legacy-peer-deps（peer 由 DSH 宿主提供）。
 * - allowScripts=true（用户确认后）：先不带 --ignore-scripts 执行（脚本按用户授权运行）；
 *   若因脚本/peer 失败，依次回退 --legacy-peer-deps → 最终 --ignore-scripts（使用仓库已提交的构建产物）。
 */
async function npmInstallWithFallback(cacheDir, env, logLine, lang, allowScripts = false) {
  const base = ["install", "--omit=dev", "--no-audit", "--no-fund"];
  const attempts = allowScripts
    ? [
        { args: base },
        { args: [...base, "--legacy-peer-deps"] },
        { args: [...base, "--legacy-peer-deps", "--ignore-scripts"], noteKey: "npmFallbackScripts" }
      ]
    : [
        { args: [...base, "--ignore-scripts"] },
        { args: [...base, "--legacy-peer-deps", "--ignore-scripts"], noteKey: "npmFallbackPeers" }
      ];
  let lastError;
  for (const attempt of attempts) {
    try {
      await runNpm(attempt.args, { cwd: cacheDir, env, timeout: 180000 });
      if (attempt.noteKey) logLine(t(lang, attempt.noteKey));
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function scanRequirements(cacheDir) {
  const names = new Set();
  const files = [];
  try { files.push(...(await readdir(cacheDir)).map((f) => join(cacheDir, f))); } catch { /* ignore */ }
  const interesting = files.filter((f) => {
    const base = f.toLowerCase();
    return /(readme|install|\.env|package\.json|\.ya?ml$|\.md$)/.test(base) && !/node_modules/.test(base);
  });
  for (const file of interesting.slice(0, 40)) {
    try {
      const text = await readFile(file, "utf8");
      for (const m of text.matchAll(ENV_PATTERN)) names.add(m[0]);
    } catch { /* binary or unreadable */ }
  }
  return [...names].slice(0, 8);
}

async function detectType(cacheDir) {
  const has = (p) => exists(join(cacheDir, p));
  if (await has("SKILL.md")) return "skill";
  if ((await has("preset.yml")) && (await has("agent.cordis.yml"))) return "agent-preset";
  if (await has("install.ps1")) return "script";
  if (await has("install.sh")) return "script";
  if (await has("package.json")) return "cordis-plugin";
  return "instructions";
}

/** 读取仓库 package.json 中 npm 会执行的生命周期脚本名（存在才返回）。 */
async function readLifecycleScripts(cacheDir) {
  try {
    const pkg = JSON.parse(await readFile(join(cacheDir, "package.json"), "utf8"));
    const scripts = pkg?.scripts ?? {};
    return ["preinstall", "install", "postinstall", "prepare"]
      .filter((name) => typeof scripts[name] === "string" && scripts[name].length > 0);
  } catch { /* 无 package.json 或解析失败 */ }
  return [];
}

function apply(ctx) {
  const webServer = ctx.get("webServer");
  if (webServer === void 0) throw new Error("dsh-plugin-marketplace: webServer service unavailable");

  // 每次 DSH 启动时自动拉取全部插件并按 Star 排序（失败静默，打开页面时会自动重试）
  getList().catch((error) => {
    ctx.logger?.warn?.(`dsh-plugin-marketplace: 启动预热拉取失败 ${error}`);
  });

  webServer.register({
    kind: "exact",
    path: "/api/marketplace/list",
    handler: async (req, res) => {
      const lang = langOf(req, { lang: new URL(req.url, "http://x").searchParams.get("lang") });
      if (req.method !== "GET") return json(res, 405, { error: t(lang, "methodNotAllowed") });
      try {
        const force = new URL(req.url, "http://x").searchParams.get("refresh") === "1";
        const repos = await getList(force);
        const profile = await scanProfilePackages();
        // 并行标注（并发上限 12），避免几百个仓库串行 stat 拖慢首屏
        const flagged = [];
        const workers = Math.min(12, repos.length);
        let cursor = 0;
        const worker = async () => {
          while (cursor < repos.length) {
            const repo = repos[cursor++];
            const record = installedMap.get(repo.full_name);
            const slug = slugify(repo.name);
            const owner = slugify(String(repo.full_name).split("/")[0] ?? "");
            let installedVersion = record && record.version ? record.version : null;
            if (!installedVersion) {
              // 目录名可能来自包名而非仓库名（如 dsh-plugin-marketplace vs DSH-Plugins-Marketplace），
              // 用包名映射表按仓库名/原始仓库名查找已装版本。
              const hit = profile.get(slug) ?? profile.get(String(repo.name).toLowerCase());
              installedVersion = hit && hit.version ? hit.version : null;
            }
            const latestVersion = await readPackageVersion(join(CACHE_DIR, `${owner}__${slug}`));
            const updateAvailable = Boolean(installedVersion && latestVersion && compareVersions(installedVersion, latestVersion) !== 0);
            flagged.push(Object.assign({}, repo, {
              installed: await detectInstalled(repo),
              installedVersion,
              latestVersion,
              updateAvailable
            }));
          }
        };
        await Promise.all(Array.from({ length: workers }, () => worker()));
        json(res, 200, { repos: flagged, cached_at: listCache.at, total: flagged.length });
      } catch (error) {
        json(res, 500, { error: t(lang, "listFail", { err: String(error?.message ?? error) }) });
      }
    }
  });

  webServer.register({
    kind: "exact",
    path: "/api/marketplace/install",
    handler: async (req, res) => {
      const lang = langOf(req, { lang: "" });
      if (req.method !== "POST") return json(res, 405, { error: t(lang, "methodNotAllowed") });
      // CSRF / DNS rebinding 防护：跨站请求无法携带自定义头，Origin 必须与 Host 一致
      if (!isTrustedRequest(req)) return json(res, 403, { error: "forbidden" });
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        return json(res, error.status === 413 ? 413 : 400, { error: error.status === 413 ? "request body too large" : "bad request" });
      }
      const langFull = langOf(req, body);
      const repo = typeof body.repo === "string" ? body.repo.trim() : "";
      const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return json(res, 400, { error: t(langFull, "badRepo") });
      // 同一仓库并发安装互斥
      if (installLocks.has(repo)) return json(res, 409, { error: "install already in progress" });
      const task = (async () => {
        const log = [];
        const logLine = (line) => log.push(line);
        let cacheDir = null;
        try {
          const [owner, repoName] = repo.split("/");
          cacheDir = join(CACHE_DIR, `${slugify(owner)}__${slugify(repoName)}`);
          logLine(t(langFull, "step1", { repo }));
          await mkdir(CACHE_DIR, { recursive: true });
          await rm(cacheDir, { recursive: true, force: true });
          await execFileAsync("git", ["clone", "--depth", "1", `https://github.com/${repo}.git`, cacheDir], { timeout: 180000 });
          logLine(t(langFull, "cloneDone"));

          const type = await detectType(cacheDir);
          logLine(t(langFull, "step2", { type: t(langFull, `type.${type}`) }));

          const required = (await scanRequirements(cacheDir)).filter((v) => !answers[v]);
          logLine(t(langFull, "step3", { list: required.length === 0 ? t(langFull, "none") : required.join(", ") }));
          if (required.length > 0) {
            logLine(t(langFull, "awaiting"));
            return json(res, 200, {
              status: "awaiting-input",
              repo, type,
              questions: required.map((v) => ({
                id: v,
                header: t(langFull, "qEnvHeader", { repo, v }),
                question: t(langFull, "qEnv", { v })
              })),
              log
            });
          }

          if (type === "script" && answers.__confirm_script__ === void 0) {
            logLine(t(langFull, "scriptDetected"));
            return json(res, 200, {
              status: "awaiting-input",
              repo, type,
              questions: [{
                id: "__confirm_script__",
                header: t(langFull, "qScriptHeader"),
                question: t(langFull, "qScript", { repo }),
                options: [
                  { value: "continue", label: t(langFull, "optContinue"), description: t(langFull, "optContinueDesc") },
                  { value: "cancel", label: t(langFull, "optCancel"), description: t(langFull, "optCancelDesc") }
                ]
              }],
              log
            });
          }
          if (type === "script" && String(answers.__confirm_script__) !== "continue") {
            logLine(t(langFull, "scriptCancelled"));
            return json(res, 200, { status: "aborted", repo, type, log });
          }

          // npm 生命周期脚本确认：cordis 插件若含 prepare/install/postinstall 等脚本，
          // 执行前必须征求用户同意（拒绝则取消安装并清空全部痕迹）
          if (type === "cordis-plugin" && answers.__confirm_npm_scripts__ === void 0) {
            const scripts = await readLifecycleScripts(cacheDir);
            if (scripts.length > 0) {
              logLine(t(langFull, "npmScriptsDetected", { scripts: scripts.join(", ") }));
              return json(res, 200, {
                status: "awaiting-input",
                repo, type,
                questions: [{
                  id: "__confirm_npm_scripts__",
                  header: t(langFull, "qNpmScriptsHeader"),
                  question: t(langFull, "qNpmScripts", { repo, scripts: scripts.join(", ") }),
                  options: [
                    { value: "allow", label: t(langFull, "optAllow"), description: t(langFull, "optAllowDesc") },
                    { value: "deny", label: t(langFull, "optDeny"), description: t(langFull, "optDenyDesc") }
                  ]
                }],
                log
              });
            }
          }
          if (type === "cordis-plugin" && String(answers.__confirm_npm_scripts__) === "deny") {
            // 用户拒绝执行第三方 npm 脚本：清理克隆缓存等全部痕迹后取消
            if (cacheDir) await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
            logLine(t(langFull, "npmScriptsDenied"));
            return json(res, 200, { status: "aborted", repo, type, log });
          }

        logLine(t(langFull, "step4"));
        const result = await installRepo({ type, cacheDir, repo, log, answers, logLine, lang: langFull, required });
        logLine(t(langFull, "step5"));
        let installed = false;
        if (result && ["skill", "agent-preset", "cordis-plugin", "script"].includes(result.type)) {
          await saveInstalled(repo, {
            type: result.type,
            name: result.name ?? null,
            location: result.location ?? null,
            version: result.version ?? null,
            installedAt: Date.now()
          });
          installed = true;
        }
        const latestVersion = await readPackageVersion(cacheDir);
        return json(res, 200, { status: "done", repo, installed, latestVersion, ...result, log });
      } catch (error) {
        // 清理失败安装留下的缓存克隆，避免残留目录导致「已安装」误判
        if (cacheDir) await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
        logLine(t(langFull, "fail", { err: String(error?.message ?? error) }));
        return json(res, 200, { status: "failed", repo, log, error: String(error?.message ?? error) });
      }
      })();
      installLocks.set(repo, task);
      try {
        return await task;
      } finally {
        installLocks.delete(repo);
      }
    }
  });
}

async function installRepo({ type, cacheDir, repo, log, answers, logLine, lang, required = [] }) {
  // M1：answers 键只放行扫描到的必需环境变量名（`__` 内部键一律不进环境），
  // 防止 PATH/HOME 等任意键注入劫持子进程。
  const env = { ...process.env };
  const allowedAnswers = new Set(required);
  for (const key of Object.keys(answers)) {
    if (key.startsWith("__")) continue;
    if (allowedAnswers.has(key)) env[key] = answers[key];
  }
  if (type === "skill") {
    let skillName = slugify(repo.split("/")[1]);
    try {
      const text = await readFile(join(cacheDir, "SKILL.md"), "utf8");
      const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const m = fm && fm[1].match(/^name:\s*"?([a-z0-9][a-z0-9-]*)"?$/m);
      if (m) skillName = m[1];
    } catch { /* keep repo-derived name */ }
    const dest = join(SKILLS_DIR, skillName);
    await mkdir(SKILLS_DIR, { recursive: true });
    await rm(dest, { recursive: true, force: true });
    await cp(cacheDir, dest, { recursive: true, filter: copyFilter(cacheDir, true) });
    logLine(t(lang, "skillInstalled", { name: skillName, dest }));
    return { type, name: skillName, location: dest };
  }
  if (type === "agent-preset") {
    const presetId = slugify(repo.split("/")[1]);
    const dest = join(PRESETS_DIR, presetId);
    await mkdir(PRESETS_DIR, { recursive: true });
    await rm(dest, { recursive: true, force: true });
    await cp(cacheDir, dest, { recursive: true, filter: copyFilter(cacheDir, true) });
    logLine(t(lang, "presetInstalled", { name: presetId, dest }));
    return { type, name: presetId, location: dest };
  }
  if (type === "script") {
    if (await exists(join(cacheDir, "install.ps1"))) {
      logLine(t(lang, "runPs1"));
      await execFileAsync("pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(cacheDir, "install.ps1")], { cwd: cacheDir, env, timeout: 600000 });
    } else {
      logLine(t(lang, "runSh"));
      await execFileAsync("bash", [join(cacheDir, "install.sh")], { cwd: cacheDir, env, timeout: 600000 });
    }
    logLine(t(lang, "scriptDone", { dir: cacheDir }));
    return { type, location: cacheDir };
  }
  if (type === "cordis-plugin") {
    let pkgName = slugify(repo.split("/")[1]);
    let deps = {};
    try {
      const pkg = JSON.parse(await readFile(join(cacheDir, "package.json"), "utf8"));
      if (typeof pkg.name === "string" && pkg.name.length > 0) pkgName = pkg.name;
      deps = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
    } catch { /* keep defaults */ }
    // C2：包名白名单校验（npm 命名规则），杜绝路径穿越 / 任意目录删除 / YAML 注入
    if (!PKG_NAME_PATTERN.test(pkgName)) {
      throw new Error(`非法包名: ${JSON.stringify(pkgName)}（拒绝安装）`);
    }
    const dest = join(PROFILE_NM, pkgName);
    // 双保险：解析后的目标路径必须仍在 profile node_modules 之内
    if (!resolve(dest).startsWith(resolve(PROFILE_NM) + sep)) {
      throw new Error(`目标路径越界: ${dest}（拒绝安装）`);
    }
    if (Object.keys(deps).length > 0) {
      logLine(t(lang, "deps", { n: Object.keys(deps).length }));
      const allowScripts = String(answers.__confirm_npm_scripts__) === "allow";
      if (allowScripts) logLine(t(lang, "npmScriptsAllowed"));
      await npmInstallWithFallback(cacheDir, env, logLine, lang, allowScripts);
      logLine(t(lang, "depsDone"));
    }
    await mkdir(PROFILE_NM, { recursive: true });
    await rm(dest, { recursive: true, force: true });
    // cordis 插件保留 node_modules（dependencies 需要随包复制），只排除 .git
    await cp(cacheDir, dest, { recursive: true, filter: copyFilter(cacheDir, false) });
    logLine(t(lang, "copied", { dest }));
    const entryId = slugify(pkgName);
    const appended = await appendPatchEntry(entryId, pkgName);
    logLine(appended ? t(lang, "patchDone", { id: entryId }) : t(lang, "patchExists"));
    const installedVersion = await readPackageVersion(dest);
    return { type, name: pkgName, location: dest, version: installedVersion };
  }
  const readme = await readFile(join(cacheDir, "README.md"), "utf8").catch(() => "");
  logLine(t(lang, "instructions"));
  logLine((readme || t(lang, "noReadme")).slice(0, 3000));
  return { type, instructions: true };
}

export { apply, detectInstalled, loadOwnRepo, scanProfilePackages, langOf, t, fetchAllRepos, fetchRegistryRepos, isTrustedRequest, compareVersions, hasPatchEntry, normalizeRepo, appendPatchEntry, readLifecycleScripts };