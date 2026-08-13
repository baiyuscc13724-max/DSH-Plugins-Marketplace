window.__ModuleLoader__.load({
  id: "dsh-plugin-marketplace",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");
    var h = react.createElement;
    var useState = react.useState;
    var useEffect = react.useEffect;

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
              h("span", { style: s.badge }, repo.stargazers_count > 0 ? "★ " + repo.stargazers_count : "新仓库")),
            h("p", { style: s.meta }, repo.full_name + " · 更新于 " + (repo.updated_at || "").slice(0, 10) + (repo.license ? " · " + repo.license : "") + " · ",
              h("a", { href: repo.html_url, target: "_blank", rel: "noopener noreferrer", style: s.link }, "Github原链"),
              updateAvailable ? h("span", { style: s.updateHint }, "已装 v" + repo.installedVersion + " → v" + repo.latestVersion) : null),
            repo.description ? h("p", { style: s.desc }, repo.description) : null,
            repo.topics && repo.topics.length > 0 ? h("p", { style: s.meta }, "标签: " + repo.topics.slice(0, 6).join(", ")) : null
          ),
          h("div", { style: { flex: "none" } },
            h("button", {
              className: "dshm-btn" + (done ? "" : " dshm-btn-primary"),
              style: done ? s.btnInstalled : s.btnPrimary,
              disabled: busy || done,
              onClick: function () { props.onInstall(repo.full_name); }
            }, busy ? "安装中..." : (updateAvailable ? "更新" : (installed ? "已安装" : "安装")))
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
          h("p", { style: s.title, margin: "0 0 8px" }, "需要你提供材料才能继续安装 " + inst.repo),
          h("div", { style: s.log }, inst.log.map(function (l, i) { return h("div", { key: i }, l); })),
          inst.questions.map(function (q) {
            var value = inputValues[q.id] || "";
            if (q.options && q.options.length > 0) {
              return h("div", { style: s.field, key: q.id },
                h("p", { style: s.q }, q.question),
                h("div", { style: { display: "flex", gap: 8, marginTop: 6 } },
                  q.options.map(function (opt) {
                    var primary = opt.label === "继续安装";
                    return h("button", {
                      key: opt.label,
                      className: primary ? "dshm-btn dshm-btn-primary" : "dshm-btn dshm-btn-danger",
                      style: primary ? s.btnPrimary : s.btnDanger,
                      onClick: function () {
                        var next = Object.assign({}, inputValues); next[q.id] = opt.label; setInputValues(next);
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
                placeholder: "粘贴 " + q.id + " 的值（如 API Key）",
                value: value,
                onChange: function (e) { var next = Object.assign({}, inputValues); next[q.id] = e.target.value; setInputValues(next); }
              })
            );
          }),
          h("div", { style: { display: "flex", gap: 8, marginTop: 12 } },
            h("button", { className: "dshm-btn dshm-btn-primary", style: s.btnPrimary, onClick: function () { props.submit(inputValues); } }, "提交材料并继续安装"),
            h("button", { className: "dshm-btn", style: s.btn, onClick: props.cancel }, "取消")
          )
        );
      }
      return h("div", { style: s.panel },
        h("p", { style: s.title, margin: "0 0 8px" }, "安装 " + inst.repo + " (" + inst.phase + ")"),
        h("div", { style: s.log }, inst.log.map(function (l, i) { return h("div", { key: i }, l); })),
        inst.result && (inst.result.status === "done") && h("p", { style: { fontSize: 13, margin: "10px 0 0", color: "var(--dsw-alias-state-success-primary)" } },
          "安装完成 ✔ 类型: " + inst.result.type + (inst.result.location ? " · 位置: " + inst.result.location : "")),
        inst.result && (inst.result.status === "aborted") && h("p", { style: s.err }, "安装已取消"),
        inst.result && (inst.result.status === "failed") && h("p", { style: s.err }, "安装失败: " + (inst.result.error || "未知错误")),
        h("button", { className: "dshm-btn", style: Object.assign({}, s.btn, { marginTop: 12 }), onClick: props.cancel }, "返回列表")
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

      useEffect(function () {
        if (!toast) return;
        var t = setTimeout(function () { setToast(null); }, 2600);
        return function () { clearTimeout(t); };
      }, [toast]);

      function doRefresh(force) {
        setToast({ text: "正在刷新 ...", ok: true });
        fetch("/api/marketplace/list" + (force ? "?refresh=1" : "")).then(function (r) { return r.json(); }).then(function (data) {
          if (data.error) { setError(data.error); setToast({ text: "刷新失败：" + data.error, ok: false }); }
          else { setRepos(data.repos || []); setToast({ text: "刷新成功，共 " + (data.repos || []).length + " 个插件", ok: true }); }
        }).catch(function (err) {
          setToast({ text: "刷新失败：" + String(err), ok: false });
        });
      }

      useEffect(function () {
        var cancelled = false;
        setError(null);
        fetch("/api/marketplace/list").then(function (r) { return r.json(); }).then(function (data) {
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
          body: JSON.stringify({ repo: repo, answers: answers || {} })
        }).then(function (r) { return r.json(); }).then(function (data) {
          if (data.status === "done" && data.installed) {
            setRepos(function (prev) {
              return (prev || []).map(function (r) {
                return r.full_name === repo ? Object.assign({}, r, { installed: true, updateAvailable: false, installedVersion: data.version ?? null, latestVersion: data.latestVersion ?? null }) : r;
              });
            });
          }
          setInst(function (prev) {
            var base = (prev && prev.log) || [];
            var log = base.concat(data.log || []);
            if (data.status === "awaiting-input") {
              return { repo: repo, phase: "input", log: log, questions: data.questions || [], answers: answers || {}, result: null };
            }
            return { repo: repo, phase: data.status === "done" ? "done" : (data.status === "aborted" ? "aborted" : "failed"), log: log, questions: [], answers: answers || {}, result: data };
          });
        }).catch(function (err) {
          setInst(function (prev) {
            return { repo: repo, phase: "failed", log: (prev && prev.log || []).concat(["请求失败: " + String(err)]), questions: [], answers: answers || {}, result: null };
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
            h("h2", { style: s.title }, "DSH插件市场"),
            h("p", { style: s.sub }, "每次启动自动拉取全部插件，按 Star 数从高到低排列（缓存 10 分钟）")
          ),
          h("button", { className: "dshm-btn", style: s.btn, onClick: function () { doRefresh(true); } }, "刷新")
        ),
        h("input", {
          style: Object.assign({}, s.input, { marginTop: 0, marginBottom: 12 }),
          type: "search",
          placeholder: "搜索插件名（如 pdf、image、ppt）...",
          value: query,
          onChange: function (e) { setQuery(e.target.value); }
        }),
        error ? h("p", { style: s.err }, "加载失败: " + error) : null,
        inst ? h(InstallPanel, { inst: inst, inputValues: inputValues, setInputValues: setInputValues, submit: submit, cancel: cancelInstall }) : null,
        repos === null ? h("p", { style: { fontSize: 13, color: "var(--dsw-alias-label-tertiary)" } }, "正在从 GitHub 加载 ...") : null,
        repos ? (function () {
          var q = query.trim().toLowerCase();
          var list = q
            ? repos.filter(function (r) {
                return (r.name + " " + r.full_name + " " + (r.topics || []).join(" ")).toLowerCase().indexOf(q) !== -1;
              })
            : repos;
          return [
            h("p", { key: "count", style: Object.assign({}, s.meta, { margin: "0 0 8px" }) },
              "共 " + repos.length + " 个插件" + (q ? "，匹配 " + list.length + " 个" : "")),
            list.map(function (repo) {
              return h(RepoCard, { key: repo.full_name, repo: repo, installed: repo.installed, updateAvailable: repo.updateAvailable, busy: !!(inst && inst.phase === "running"), onInstall: function (fullName) { setInputValues({}); runInstall(fullName, {}, []); } });
            }),
            list.length === 0 ? h("p", { key: "empty", style: { fontSize: 13, color: "var(--dsw-alias-label-tertiary)" } }, "没有匹配「" + query + "」的插件") : null
          ];
        })() : null,
        repos && repos.length === 0 && !error ? h("p", { style: { fontSize: 13, color: "var(--dsw-alias-label-tertiary)" } }, "没有找到插件（GitHub 上 topic 为 dsh-plugin 的仓库为空或搜索受限）") : null
      );
    }

    function apply(ctx) {
      injectStyles();
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "dsh-plugin-marketplace",
          order: 30,
          label: function () { return "DSH插件市场"; }
        }, MarketplaceSection);
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
