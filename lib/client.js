window.__ModuleLoader__.load({
  id: "dsh-plugin-marketplace",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");
    var h = react.createElement;
    var useState = react.useState;
    var useEffect = react.useEffect;

    // ===== 双语文案 =====
    var NS = "dsh-plugin-marketplace";
    var DICT_ZH = {
      sectionLabel: "DSH插件市场",
      pageSub: "每次启动自动拉取全部插件，按 Star 数从高到低排列（缓存 10 分钟）",
      refresh: "刷新",
      refreshing: "正在刷新 ...",
      refreshOk: "刷新成功，共 {n} 个插件",
      refreshFail: "刷新失败：{err}",
      loading: "正在从 GitHub 加载 ...",
      countTotal: "共 {n} 个插件",
      countMatch: "，匹配 {n} 个",
      noMatch: "没有匹配「{q}」的插件",
      empty: "没有找到插件（GitHub 上 topic 为 dsh-plugin 的仓库为空或搜索受限）",
      loadFail: "加载失败: {err}",
      badgeNew: "新仓库",
      updatedAt: "更新于 {d}",
      githubLink: "Github原链",
      tags: "标签: {tags}",
      installed: "已安装",
      install: "安装",
      update: "更新",
      installing: "安装中...",
      updateHint: "已装 v{old} → v{new}",
      inputTitle: "需要你提供材料才能继续安装 {repo}",
      placeholder: "粘贴 {name} 的值（如 API Key）",
      submitContinue: "提交材料并继续安装",
      cancel: "取消",
      panelTitle: "安装 {repo} ({phase})",
      "phase.running": "运行中",
      "phase.input": "等待输入",
      "phase.done": "完成",
      "phase.aborted": "已取消",
      "phase.failed": "失败",
      doneMsg: "安装完成 ✔ 类型: {type}",
      doneMsgLoc: " · 位置: {loc}",
      abortedMsg: "安装已取消",
      failedMsg: "安装失败: {err}",
      backToList: "返回列表",
      requestFail: "请求失败: {err}",
      searchPlaceholder: "搜索插件名（如 pdf、image、ppt）..."
    };
    var DICT_EN = {
      sectionLabel: "DSH Plugin Marketplace",
      pageSub: "Fetches all plugins on startup, sorted by stars (10-min cache)",
      refresh: "Refresh",
      refreshing: "Refreshing ...",
      refreshOk: "Refreshed — {n} plugins",
      refreshFail: "Refresh failed: {err}",
      loading: "Loading from GitHub ...",
      countTotal: "{n} plugins",
      countMatch: ", {n} matched",
      noMatch: "No plugin matches \"{q}\"",
      empty: "No plugins found (no repos with the dsh-plugin topic, or GitHub search is rate-limited)",
      loadFail: "Failed to load: {err}",
      badgeNew: "new repo",
      updatedAt: "updated {d}",
      githubLink: "GitHub repo",
      tags: "Tags: {tags}",
      installed: "Installed",
      install: "Install",
      update: "Update",
      installing: "Installing...",
      updateHint: "v{old} → v{new} installed",
      inputTitle: "Input required to continue installing {repo}",
      placeholder: "Paste value for {name} (e.g. API key)",
      submitContinue: "Submit and continue install",
      cancel: "Cancel",
      panelTitle: "Installing {repo} ({phase})",
      "phase.running": "running",
      "phase.input": "awaiting input",
      "phase.done": "done",
      "phase.aborted": "cancelled",
      "phase.failed": "failed",
      doneMsg: "Install complete ✔ Type: {type}",
      doneMsgLoc: " · Location: {loc}",
      abortedMsg: "Install cancelled",
      failedMsg: "Install failed: {err}",
      backToList: "Back to list",
      requestFail: "Request failed: {err}",
      searchPlaceholder: "Search plugins (e.g. pdf, image, ppt)..."
    };

    function browserLang() {
      var raw = (typeof navigator !== "undefined" && navigator.language) || "zh";
      return String(raw).toLowerCase().split("-")[0] === "zh" ? "zh" : "en";
    }
    var langCurrent = browserLang();
    /** 翻译函数：apply 时替换为 DSH locale 服务的绑定，否则用浏览器语言回退。 */
    var t = function (key, vars) {
      var dict = langCurrent === "en" ? DICT_EN : DICT_ZH;
      var s = dict[key] || key;
      if (vars) for (var k in vars) s = s.split("{" + k + "}").join(String(vars[k]));
      return s;
    };
    var localeChangeCbs = [];
    function notifyLocaleChange() {
      for (var i = 0; i < localeChangeCbs.length; i++) {
        try { localeChangeCbs[i](); } catch (e) { /* ignore */ }
      }
    }

    // 全部使用 DSH 主题令牌（--dsw-alias-*），自动适配深色/浅色模式
    var s = {
      page: { maxWidth: 880, fontFamily: "var(--dsw-font-family, system-ui, sans-serif)", color: "var(--dsw-alias-label-primary)", padding: "4px 2px" },
      head: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 },
      title: { fontSize: 17, fontWeight: 600, margin: 0, color: "var(--dsw-alias-label-primary)" },
      sub: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", margin: "2px 0 0" },
      btn: { padding: "5px 14px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l3)", background: "var(--dsw-alias-bg-layer-2)", color: "var(--dsw-alias-label-primary)", cursor: "pointer", fontSize: 13, minWidth: 72, whiteSpace: "nowrap" },
      btnPrimary: { padding: "5px 14px", borderRadius: 6, border: "1px solid transparent", background: "var(--dsw-alias-button-primary-fill)", color: "var(--dsw-alias-label-primary-foreground)", cursor: "pointer", fontSize: 13, minWidth: 72, whiteSpace: "nowrap" },
      btnDanger: { padding: "5px 14px", borderRadius: 6, border: "1px solid var(--dsw-alias-state-error-secondary)", background: "transparent", color: "var(--dsw-alias-state-error-primary)", cursor: "pointer", fontSize: 13, minWidth: 72, whiteSpace: "nowrap" },
      btnInstalled: { padding: "5px 14px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-tertiary)", cursor: "default", fontSize: 13, minWidth: 72, whiteSpace: "nowrap", opacity: 0.85 },
      card: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 10, padding: "12px 14px", marginBottom: 10, background: "var(--dsw-alias-bg-layer-2)" },
      row: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
      name: { fontSize: 14, fontWeight: 600, margin: 0, color: "var(--dsw-alias-label-primary)" },
      meta: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", margin: "3px 0 0" },
      link: { color: "var(--dsw-alias-brand-primary)", textDecoration: "none", cursor: "pointer", marginLeft: 4 },
      updateHint: { color: "var(--dsw-alias-state-warn-primary)", marginLeft: 4 },
      desc: { fontSize: 13, margin: "8px 0 0", lineHeight: 1.5, color: "var(--dsw-alias-label-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word" },
      log: { background: "var(--dsw-alias-bg-base)", border: "1px solid var(--dsw-alias-border-l2)", color: "var(--dsw-alias-label-secondary)", borderRadius: 8, padding: "10px 12px", fontSize: 12, lineHeight: 1.6, maxHeight: 300, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace" },
      input: { width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l3)", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", fontSize: 13, marginTop: 4 },
      field: { margin: "10px 0" },
      q: { fontSize: 13, margin: "0 0 2px", color: "var(--dsw-alias-label-secondary)" },
      badge: { display: "inline-block", padding: "1px 8px", borderRadius: 10, fontSize: 11, border: "1px solid var(--dsw-alias-border-l3)", color: "var(--dsw-alias-label-tertiary)", marginLeft: 8 },
      panel: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 10, padding: "12px 14px", marginBottom: 12, background: "var(--dsw-alias-bg-layer-2)" },
      err: { color: "var(--dsw-alias-state-error-primary)", fontSize: 13, margin: "8px 0 0" },
      toast: { position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)", zIndex: 2000, maxWidth: "80vw", padding: "8px 16px", borderRadius: 10, fontSize: 13, boxShadow: "var(--dsw-shadow-lv3, 0 8px 24px rgba(0,0,0,.25))", background: "var(--dsw-alias-button-contrast-fill)", color: "var(--dsw-alias-label-primary-inverted)" },
      toastErr: { position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)", zIndex: 2000, maxWidth: "80vw", padding: "8px 16px", borderRadius: 10, fontSize: 13, boxShadow: "var(--dsw-shadow-lv3, 0 8px 24px rgba(0,0,0,.25))", background: "var(--dsw-alias-state-error-primary)", color: "var(--dsw-alias-label-primary-inverted)" }
    };

    function injectStyles() {
      if (document.getElementById("dshm-styles")) return;
      var el = document.createElement("style");
      el.id = "dshm-styles";
      el.textContent = [
        ".dshm-btn{transition:background .12s var(--ds-ease-in-out, ease)}",
        ".dshm-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
        ".dshm-btn:disabled{opacity:.55;cursor:default}",
        ".dshm-btn-primary:hover{background:var(--dsw-alias-button-primary-hover)}",
        ".dshm-btn-danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger)}",
        ".dshm-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}"
      ].join("\n");
      document.head.appendChild(el);
    }

    function RepoCard(props) {
      var repo = props.repo;
      var busy = props.busy;
      var installed = !!props.installed;
      var updateAvailable = !!props.updateAvailable;
      var done = installed && !updateAvailable;
      return h("div", { style: s.card },
        h("div", { style: s.row },
          h("div", { style: { flex: 1, minWidth: 0, marginRight: 12 } },
            h("p", { style: s.name }, repo.name,
              h("span", { style: s.badge }, repo.stargazers_count > 0 ? "★ " + repo.stargazers_count : t("badgeNew"))),
            h("p", { style: s.meta }, repo.full_name + " · " + t("updatedAt", { d: (repo.updated_at || "").slice(0, 10) }) + (repo.license ? " · " + repo.license : "") + " · ",
              h("a", { href: repo.html_url, target: "_blank", rel: "noopener noreferrer", style: s.link }, t("githubLink")),
              updateAvailable ? h("span", { style: s.updateHint }, t("updateHint", { old: repo.installedVersion, new: repo.latestVersion })) : null),
            repo.description ? h("p", { style: s.desc }, repo.description) : null,
            repo.topics && repo.topics.length > 0 ? h("p", { style: s.meta }, t("tags", { tags: repo.topics.slice(0, 6).join(", ") })) : null
          ),
          h("div", { style: { flex: "none" } },
            h("button", {
              className: "dshm-btn" + (done ? "" : " dshm-btn-primary"),
              style: done ? s.btnInstalled : s.btnPrimary,
              disabled: busy || done,
              onClick: function () { props.onInstall(repo.full_name); }
            }, busy ? t("installing") : (updateAvailable ? t("update") : (installed ? t("installed") : t("install"))))
          )
        )
      );
    }

    function InstallPanel(props) {
      var inst = props.inst;
      var inputValues = props.inputValues;
      var setInputValues = props.setInputValues;
      if (inst.phase === "input") {
        return h("div", { style: s.panel },
          h("p", { style: s.title, margin: "0 0 8px" }, t("inputTitle", { repo: inst.repo })),
          h("div", { style: s.log }, inst.log.map(function (l, i) { return h("div", { key: i }, l); })),
          inst.questions.map(function (q) {
            var value = inputValues[q.id] || "";
            if (q.options && q.options.length > 0) {
              return h("div", { style: s.field, key: q.id },
                h("p", { style: s.q }, q.question),
                h("div", { style: { display: "flex", gap: 8, marginTop: 6 } },
                  q.options.map(function (opt) {
                    var primary = opt.value === "continue";
                    return h("button", {
                      key: opt.value || opt.label,
                      className: primary ? "dshm-btn dshm-btn-primary" : "dshm-btn dshm-btn-danger",
                      style: primary ? s.btnPrimary : s.btnDanger,
                      onClick: function () {
                        var next = Object.assign({}, inputValues); next[q.id] = opt.value || opt.label; setInputValues(next);
                        props.submit(next);
                      }
                    }, opt.label);
                  })
                )
              );
            }
            return h("div", { style: s.field, key: q.id },
              h("p", { style: s.q }, q.question),
              h("input", {
                style: s.input,
                type: "text",
                placeholder: t("placeholder", { name: q.id }),
                value: value,
                onChange: function (e) { var next = Object.assign({}, inputValues); next[q.id] = e.target.value; setInputValues(next); }
              })
            );
          }),
          h("div", { style: { display: "flex", gap: 8, marginTop: 12 } },
            h("button", { className: "dshm-btn dshm-btn-primary", style: s.btnPrimary, onClick: function () { props.submit(inputValues); } }, t("submitContinue")),
            h("button", { className: "dshm-btn", style: s.btn, onClick: props.cancel }, t("cancel"))
          )
        );
      }
      var phaseName = t("phase." + inst.phase) || inst.phase;
      return h("div", { style: s.panel },
        h("p", { style: s.title, margin: "0 0 8px" }, t("panelTitle", { repo: inst.repo, phase: phaseName })),
        h("div", { style: s.log }, inst.log.map(function (l, i) { return h("div", { key: i }, l); })),
        inst.result && (inst.result.status === "done") && h("p", { style: { fontSize: 13, margin: "10px 0 0", color: "var(--dsw-alias-state-success-primary)" } },
          t("doneMsg", { type: inst.result.type }) + (inst.result.location ? t("doneMsgLoc", { loc: inst.result.location }) : "")),
        inst.result && (inst.result.status === "aborted") && h("p", { style: s.err }, t("abortedMsg")),
        inst.result && (inst.result.status === "failed") && h("p", { style: s.err }, t("failedMsg", { err: (inst.result.error || "unknown") })),
        h("button", { className: "dshm-btn", style: Object.assign({}, s.btn, { marginTop: 12 }), onClick: props.cancel }, t("backToList"))
      );
    }

    function MarketplaceSection() {
      var state = useState(null); var repos = state[0]; var setRepos = state[1];
      var state2 = useState(null); var error = state2[0]; var setError = state2[1];
      var state3 = useState(null); var inst = state3[0]; var setInst = state3[1];
      var state4 = useState({}); var inputValues = state4[0]; var setInputValues = state4[1];
      var state5 = useState(0); var tick = state5[0]; var setTick = state5[1];
      var state6 = useState(""); var query = state6[0]; var setQuery = state6[1];
      var state7 = useState(null); var toast = state7[0]; var setToast = state7[1];
      var state8 = useState(0); var setRerender = state8[1];

      useEffect(function () {
        if (!toast) return;
        var t2 = setTimeout(function () { setToast(null); }, 2600);
        return function () { clearTimeout(t2); };
      }, [toast]);

      // 语言切换时重新渲染（翻译函数读取实时语言快照）
      useEffect(function () {
        var cb = function () { setRerender(function (n) { return n + 1; }); };
        localeChangeCbs.push(cb);
        return function () {
          var i = localeChangeCbs.indexOf(cb);
          if (i >= 0) localeChangeCbs.splice(i, 1);
        };
      }, []);

      function doRefresh(force) {
        setToast({ text: t("refreshing"), ok: true });
        fetch("/api/marketplace/list?lang=" + langCurrent + (force ? "&refresh=1" : "")).then(function (r) { return r.json(); }).then(function (data) {
          if (data.error) { setError(data.error); setToast({ text: t("refreshFail", { err: data.error }), ok: false }); }
          else { setRepos(data.repos || []); setToast({ text: t("refreshOk", { n: (data.repos || []).length }), ok: true }); }
        }).catch(function (err) {
          setToast({ text: t("refreshFail", { err: String(err) }), ok: false });
        });
      }

      useEffect(function () {
        var cancelled = false;
        setError(null);
        fetch("/api/marketplace/list?lang=" + langCurrent).then(function (r) { return r.json(); }).then(function (data) {
          if (cancelled) return;
          if (data.error) { setError(data.error); setRepos([]); }
          else setRepos(data.repos || []);
        }).catch(function (err) { if (!cancelled) { setError(String(err)); setRepos([]); } });
        return function () { cancelled = true; };
      }, [tick]);

      function runInstall(repo, answers, baseLog) {
        setInst({ repo: repo, phase: "running", log: baseLog || [], questions: [], answers: answers, result: null });
        fetch("/api/marketplace/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo: repo, answers: answers || {}, lang: langCurrent })
        }).then(function (r) { return r.json(); }).then(function (data) {
          if (data.status === "done" && data.installed) {
            setRepos(function (prev) {
              return (prev || []).map(function (r) {
                return r.full_name === repo ? Object.assign({}, r, { installed: true, updateAvailable: false, installedVersion: data.version ?? null, latestVersion: data.latestVersion ?? null }) : r;
              });
            });
          }
          setInst(function (prev) {
            // 面板可能已被另一个安装占用：过期响应直接丢弃，避免旧日志覆盖新面板
            if (!prev || prev.repo !== repo) return prev;
            var base = prev.log || [];
            var log = base.concat(data.log || []);
            if (data.status === "awaiting-input") {
              return { repo: repo, phase: "input", log: log, questions: data.questions || [], answers: answers || {}, result: null };
            }
            return { repo: repo, phase: data.status === "done" ? "done" : (data.status === "aborted" ? "aborted" : "failed"), log: log, questions: [], answers: answers || {}, result: data };
          });
        }).catch(function (err) {
          setInst(function (prev) {
            if (!prev || prev.repo !== repo) return prev;
            return { repo: repo, phase: "failed", log: (prev.log || []).concat([t("requestFail", { err: String(err) })]), questions: [], answers: answers || {}, result: null };
          });
        });
      }

      function submit(values) {
        if (!inst) return;
        var merged = Object.assign({}, inst.answers || {}, values || {});
        runInstall(inst.repo, merged, inst.log);
      }

      function cancelInstall() {
        setInst(null);
        setInputValues({});
        setTick(tick + 1);
      }

      return h("div", { style: s.page },
        toast ? h("div", { style: toast.ok ? s.toast : s.toastErr }, toast.text) : null,
        h("div", { style: s.head },
          h("div", null,
            h("h2", { style: s.title }, t("sectionLabel")),
            h("p", { style: s.sub }, t("pageSub"))
          ),
          h("button", { className: "dshm-btn", style: s.btn, onClick: function () { doRefresh(true); } }, t("refresh"))
        ),
        h("input", {
          style: Object.assign({}, s.input, { marginTop: 0, marginBottom: 12 }),
          type: "search",
          placeholder: t("searchPlaceholder"),
          value: query,
          onChange: function (e) { setQuery(e.target.value); }
        }),
        error ? h("p", { style: s.err }, t("loadFail", { err: error })) : null,
        inst ? h(InstallPanel, { inst: inst, inputValues: inputValues, setInputValues: setInputValues, submit: submit, cancel: cancelInstall }) : null,
        repos === null ? h("p", { style: { fontSize: 13, color: "var(--dsw-alias-label-tertiary)" } }, t("loading")) : null,
        repos ? (function () {
          var q = query.trim().toLowerCase();
          var list = q
            ? repos.filter(function (r) {
                return (r.name + " " + r.full_name + " " + (r.topics || []).join(" ")).toLowerCase().indexOf(q) !== -1;
              })
            : repos;
          return [
            h("p", { key: "count", style: Object.assign({}, s.meta, { margin: "0 0 8px" }) },
              t("countTotal", { n: repos.length }) + (q ? t("countMatch", { n: list.length }) : "")),
            list.map(function (repo) {
              // busy 仅对正在安装的那个仓库生效，避免一个安装中时所有按钮都变成「安装中...」
              return h(RepoCard, { key: repo.full_name, repo: repo, installed: repo.installed, updateAvailable: repo.updateAvailable, busy: !!(inst && inst.phase === "running" && inst.repo === repo.full_name), onInstall: function (fullName) { setInputValues({}); runInstall(fullName, {}, []); } });
            }),
            list.length === 0 ? h("p", { key: "empty", style: { fontSize: 13, color: "var(--dsw-alias-label-tertiary)" } }, t("noMatch", { q: query })) : null
          ];
        })() : null,
        repos && repos.length === 0 && !error ? h("p", { style: { fontSize: 13, color: "var(--dsw-alias-label-tertiary)" } }, t("empty")) : null
      );
    }

    function apply(ctx) {
      injectStyles();
      // 接入 DSH locale 服务：注册本插件字典并跟随语言切换；不可用时回退浏览器语言
      try {
        var localeSvc = ctx.get("locale");
        if (localeSvc && typeof localeSvc.register === "function") {
          localeSvc.register(NS, { zh: DICT_ZH, en: DICT_EN });
          t = localeSvc.bind(NS);
          try { langCurrent = localeSvc.getLocale().active || langCurrent; } catch (e) { /* ignore */ }
          if (typeof localeSvc.subscribe === "function") {
            localeSvc.subscribe(function () {
              try { langCurrent = localeSvc.getLocale().active; } catch (e) { /* ignore */ }
              notifyLocaleChange();
            });
          }
        }
      } catch (e) { /* locale 服务不可用，保持浏览器语言回退 */ }
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "dsh-plugin-marketplace",
          order: 30,
          locale: NS,
          label: function () { return t("sectionLabel"); }
        }, MarketplaceSection);
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
