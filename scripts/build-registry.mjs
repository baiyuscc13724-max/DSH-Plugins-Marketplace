#!/usr/bin/env node
/**
 * 生成 registry.json —— DSH 插件市场的静态索引。
 *
 * 数据源：GitHub Search API（topic:dsh-plugin，按更新时间排序分页翻到底）。
 * 由 GitHub Actions 每日定时执行（见 .github/workflows/registry.yml），
 * 产物提交回 main 分支，插件通过 jsDelivr CDN 读取，零 API 限流。
 *
 * 环境变量：
 *   GH_TOKEN / GITHUB_TOKEN  有则带认证头（限流 30 次/分钟，Actions 内自动提供）
 *   MAX_PAGES                最大翻页数（默认 100，本地测试可设小）
 *   REGISTRY_FILE            输出路径（默认仓库根 registry.json）
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = process.env.REGISTRY_FILE ?? join(ROOT, "..", "registry.json");
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 100);
const PER_PAGE = 100;
const QUERY = "topic:dsh-plugin";
const EXCLUDED = new Set(["deepseek-harness"]);
const DELAY_MS = TOKEN ? 2200 : 6500; // 限流：带 token 30/min，未认证 10/min

function log(msg) {
  console.log(`[registry] ${msg}`);
}

async function fetchPage(page) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(QUERY)}&sort=updated&order=desc&per_page=${PER_PAGE}&page=${page}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "dsh-plugin-marketplace-registry",
      Accept: "application/vnd.github+json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {})
    }
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  return await res.json();
}

function normalize(r) {
  return {
    full_name: r.full_name,
    name: r.name,
    description: r.description,
    html_url: r.html_url,
    stargazers_count: r.stargazers_count,
    updated_at: r.updated_at,
    default_branch: r.default_branch ?? "main",
    topics: r.topics ?? [],
    license: r.license?.spdx_id ?? null
  };
}

async function loadExisting() {
  try {
    const data = JSON.parse(await readFile(OUT_FILE, "utf8"));
    if (data && Array.isArray(data.repos)) return data.repos;
  } catch { /* 首次运行 */ }
  return [];
}

async function main() {
  const fresh = [];
  const seen = new Set();
  let totalCount = null;
  let complete = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const data = await fetchPage(page);
      totalCount = data.total_count ?? totalCount;
      const items = data.items ?? [];
      for (const r of items) {
        if (seen.has(r.full_name)) continue;
        seen.add(r.full_name);
        if (EXCLUDED.has(r.name)) continue;
        fresh.push(normalize(r));
      }
      log(`page ${page}: +${items.length}（累计 ${fresh.length}${totalCount != null ? ` / ${totalCount}` : ""}）`);
      if (items.length < PER_PAGE) { complete = true; break; }
      if (totalCount != null && fresh.length >= totalCount) { complete = true; break; }
    } catch (error) {
      log(`page ${page} 失败：${error.message}（使用已拉取的部分数据）`);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  // 增量合并：完整拉取则整体替换，否则保留旧条目（新数据优先）。
  // 每个条目记录 registry_seen_at（最近一次在拉取结果中出现的时间），
  // partial 合并时剔除超过 STALE_DAYS 未再出现的条目（topic 已移除的仓库不再长期残留）。
  const STALE_DAYS = 14;
  const now = Date.now();
  const existing = complete ? [] : await loadExisting();
  const freshNames = new Set(fresh.map((r) => r.full_name));
  const merged = new Map();
  for (const r of [...existing, ...fresh]) {
    if (!r || typeof r.full_name !== "string" || EXCLUDED.has(r.name)) continue;
    const seenAt = freshNames.has(r.full_name)
      ? new Date().toISOString()
      : (r.registry_seen_at || "1970-01-01T00:00:00.000Z");
    if (Date.parse(seenAt) < now - STALE_DAYS * 24 * 3600 * 1000) continue;
    merged.set(r.full_name, { ...r, registry_seen_at: seenAt });
  }
  const repos = [...merged.values()].sort((a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0));
  const out = {
    generated_at: new Date().toISOString(),
    count: repos.length,
    source: complete ? "full" : "partial-merge",
    repos
  };
  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(out, null, 2) + "\n", "utf8");
  log(`已写入 ${OUT_FILE}：${repos.length} 个插件（${out.source}）`);
}

main().catch((error) => {
  console.error(`[registry] 失败：${error.message}`);
  process.exit(1);
});
