import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, cp, readFile, writeFile, stat, readdir } from "node:fs/promises";
import { join } from "node:path";
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
const MAX_PAGES = 10;
const CACHE_TTL_MS = 10 * 60 * 1000;
const ENV_PATTERN = /\b[A-Z][A-Z0-9_]{1,}(?:API_KEY|_KEY|_TOKEN|_SECRET|_PASSWORD|_PASS)\b/g;
const INSTALLED_FILE = join(MARKET_ROOT, "installed.json");

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

/** 持久化一条安装记录（成功后写入，重启后仍能识别为已安装）。 */
async function saveInstalled(fullName, record) {
  installedMap.set(fullName, record);
  profileScanCache = null; // 新安装会新增目录，下次扫描重新建立映射
  const data = {};
  for (const [key, value] of installedMap) data[key] = value;
  await mkdir(MARKET_ROOT, { recursive: true });
  await writeFile(INSTALLED_FILE, JSON.stringify(data, null, 2), "utf8");
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
        const pkg = JSON.parse(await readFile(join(dir, entry.name, "package.json"), "utf8").catch(() => "{}"));
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
    join(PROFILE_NM, repo.name),
    cacheDir
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return true;
  }
  const self = await loadOwnRepo();
  if (self && String(repo.full_name).toLowerCase() === self) return true;
  const profile = await scanProfilePackages();
  if (profile.has(slug) || profile.has(String(repo.name).toLowerCase())) return true;
  const pkgName = await readPackageName(cacheDir);
  if (pkgName && profile.has(pkgName.toLowerCase())) return true;
  return false;
}

await loadInstalled();

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "plugin";
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
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "dsh-plugin-marketplace", "Accept": "application/vnd.github+json" }
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
 * 拉取 topic:dsh-plugin 的全部仓库（分页翻到底），去重并排除 DSH 本体后按 Star 数从高到低排序。
 * 单次最多 MAX_PAGES 页（1000 个仓库上限内）。
 */
async function fetchAllRepos() {
  const collected = [];
  const seen = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(SEARCH_QUERY)}&sort=updated&order=desc&per_page=${PAGE_SIZE}&page=${page}`;
    const data = await fetchJson(url);
    const items = data.items ?? [];
    for (const r of items) {
      if (seen.has(r.full_name)) continue;
      seen.add(r.full_name);
      if (EXCLUDED_REPO_NAMES.has(r.name)) continue;
      collected.push(r);
    }
    if (items.length < PAGE_SIZE) break;
  }
  collected.sort((a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0));
  return collected.map((r) => ({
    full_name: r.full_name,
    name: r.name,
    description: r.description,
    html_url: r.html_url,
    stargazers_count: r.stargazers_count,
    updated_at: r.updated_at,
    default_branch: r.default_branch ?? "main",
    topics: r.topics ?? [],
    license: r.license?.spdx_id ?? null
  }));
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
      if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
      try {
        const force = new URL(req.url, "http://x").searchParams.get("refresh") === "1";
        const repos = await getList(force);
        const flagged = [];
        for (const repo of repos) {
          const record = installedMap.get(repo.full_name);
          const slug = slugify(repo.name);
          const owner = slugify(String(repo.full_name).split("/")[0] ?? "");
          let installedVersion = record && record.version ? record.version : null;
          if (!installedVersion) {
            // 目录名可能来自包名而非仓库名（如 dsh-plugin-marketplace vs DSH-Plugins-Marketplace），
            // 用包名映射表按仓库名/原始仓库名查找已装版本。
            const profile = await scanProfilePackages();
            const hit = profile.get(slug) ?? profile.get(String(repo.name).toLowerCase());
            installedVersion = hit && hit.version ? hit.version : null;
          }
          const latestVersion = await readPackageVersion(join(CACHE_DIR, `${owner}__${slug}`));
          const updateAvailable = Boolean(installedVersion && latestVersion && installedVersion !== latestVersion);
          flagged.push(Object.assign({}, repo, {
            installed: await detectInstalled(repo),
            installedVersion,
            latestVersion,
            updateAvailable
          }));
        }
        json(res, 200, { repos: flagged, cached_at: listCache.at, total: flagged.length });
      } catch (error) {
        json(res, 500, { error: String(error?.message ?? error) });
      }
    }
  });

  webServer.register({
    kind: "exact",
    path: "/api/marketplace/install",
    handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
      const body = await readJsonBody(req);
      const repo = typeof body.repo === "string" ? body.repo.trim() : "";
      const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return json(res, 400, { error: "repo 参数格式应为 owner/name" });
      const log = [];
      const logLine = (line) => log.push(line);
      try {
        const [owner, repoName] = repo.split("/");
        const cacheDir = join(CACHE_DIR, `${slugify(owner)}__${slugify(repoName)}`);
        logLine(`[1/5] 克隆 https://github.com/${repo} ...`);
        await mkdir(CACHE_DIR, { recursive: true });
        await rm(cacheDir, { recursive: true, force: true });
        await execFileAsync("git", ["clone", "--depth", "1", `https://github.com/${repo}.git`, cacheDir], { timeout: 180000 });
        logLine("克隆完成。");

        const type = await detectType(cacheDir);
        logLine(`[2/5] 识别安装类型: ${type}`);

        const required = (await scanRequirements(cacheDir)).filter((v) => !answers[v]);
        logLine(`[3/5] 扫描所需环境变量: ${required.length === 0 ? "无" : required.join(", ")}`);
        if (required.length > 0) {
          logLine("需要用户提供材料，安装已暂停。");
          return json(res, 200, {
            status: "awaiting-input",
            repo, type,
            questions: required.map((v) => ({
              id: v,
              header: `${repo} 需要 ${v}`,
              question: `该插件需要环境变量 ${v}（通常是 API Key 等密钥）。请提供其值以继续安装（空值可跳过）：`
            })),
            log
          });
        }

        if (type === "script" && answers.__confirm_script__ === void 0) {
          logLine("检测到安装脚本，需要用户确认。");
          return json(res, 200, {
            status: "awaiting-input",
            repo, type,
            questions: [{
              id: "__confirm_script__",
              header: "确认执行第三方脚本",
              question: `仓库 ${repo} 包含安装脚本（install.sh / install.ps1），安装将执行该脚本。下载并运行第三方代码存在安全风险，是否继续？`,
              options: [
                { label: "继续安装", description: "信任该仓库并执行其安装脚本" },
                { label: "取消安装", description: "不执行任何脚本" }
              ]
            }],
            log
          });
        }
        if (type === "script" && String(answers.__confirm_script__) !== "继续安装") {
          logLine("用户取消安装脚本执行。");
          return json(res, 200, { status: "aborted", repo, type, log });
        }

        logLine("[4/5] 开始安装 ...");
        const result = await installRepo({ type, cacheDir, repo, log, answers, logLine });
        logLine("[5/5] 完成。");
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
        logLine(`安装失败: ${error?.message ?? error}`);
        return json(res, 200, { status: "failed", repo, log, error: String(error?.message ?? error) });
      }
    }
  });
}

async function installRepo({ type, cacheDir, repo, log, answers, logLine }) {
  const env = { ...process.env, ...answers };
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
    await cp(cacheDir, dest, { recursive: true, filter: (src) => !src.includes(join(cacheDir, "node_modules")) });
    logLine(`skill「${skillName}」已安装到 ${dest}，技能注册器将自动热加载。`);
    return { type, name: skillName, location: dest };
  }
  if (type === "agent-preset") {
    const presetId = slugify(repo.split("/")[1]);
    const dest = join(PRESETS_DIR, presetId);
    await mkdir(PRESETS_DIR, { recursive: true });
    await rm(dest, { recursive: true, force: true });
    await cp(cacheDir, dest, { recursive: true, filter: (src) => !src.includes(join(cacheDir, "node_modules")) });
    logLine(`agent 预设「${presetId}」已安装到 ${dest}。`);
    return { type, name: presetId, location: dest };
  }
  if (type === "script") {
    if (await exists(join(cacheDir, "install.ps1"))) {
      logLine("正在执行 install.ps1 ...");
      await execFileAsync("pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(cacheDir, "install.ps1")], { cwd: cacheDir, env, timeout: 600000 });
    } else {
      logLine("正在执行 install.sh (bash) ...");
      await execFileAsync("bash", [join(cacheDir, "install.sh")], { cwd: cacheDir, env, timeout: 600000 });
    }
    logLine("安装脚本执行完成。仓库保留在 " + cacheDir);
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
    if (Object.keys(deps).length > 0) {
      logLine(`正在安装依赖 (npm install --omit=dev)，共 ${Object.keys(deps).length} 项 ...`);
      await execFileAsync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: cacheDir, env, timeout: 600000 });
      logLine("依赖安装完成。");
    }
    const dest = join(PROFILE_NM, pkgName);
    await mkdir(PROFILE_NM, { recursive: true });
    await rm(dest, { recursive: true, force: true });
    await cp(cacheDir, dest, { recursive: true, filter: (src) => !src.includes(join(cacheDir, "node_modules")) });
    logLine(`插件包已复制到 ${dest}`);
    const patch = await readFile(PATCH_FILE, "utf8").catch(() => "");
    const entryId = slugify(pkgName);
    if (patch.includes(`name: ${pkgName}`)) {
      logLine("profile 补丁中已存在该插件条目，跳过注册。");
    } else {
      const trimmed = patch.trim();
      const row = `    - id: ${entryId}\n      name: ${pkgName}\n`;
      const next = trimmed === "" || trimmed === "[]"
        ? `# dsh-plugin-marketplace 自动注册的插件条目\n- insert:\n${row}`
        : patch.endsWith("\n") ? patch + "- insert:\n" + row : patch + "\n- insert:\n" + row;
      await writeFile(PATCH_FILE, next, "utf8");
      logLine(`已注册到 web profile 补丁 (id: ${entryId})。加载器热重载后生效；若未生效请重启 dsh web 并刷新页面。`);
    }
    const installedVersion = await readPackageVersion(dest);
    return { type, name: pkgName, location: dest, version: installedVersion };
  }
  const readme = await readFile(join(cacheDir, "README.md"), "utf8").catch(() => "");
  logLine("该仓库不含可自动安装的 SKILL.md / agent 预设 / 安装脚本 / 插件清单，请按 README 手动安装：");
  logLine((readme || "（无 README）").slice(0, 3000));
  return { type, instructions: true };
}

export { apply, detectInstalled, loadOwnRepo, scanProfilePackages };