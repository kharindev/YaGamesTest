(() => {
  if (window === window.top && !/^\/games\/app\//.test(location.pathname)) return;
  const contentVersion = chrome.runtime.getManifest().version;
  const previous = window.__YA_GAMES_QA_CONTENT_CONTROLLER__;
  if (previous?.version === contentVersion) return;
  try { previous?.stop?.(); } catch (_) {}
  window.__YA_GAMES_LOAD_AUDITOR_CONTENT__ = contentVersion;

  let contextValid = true;
  let observer = null;
  let metricsTimer = null;
  let port = null;
  let overlayHost = null;
  let activeOverlayTest = null;
  let activeDashboardSection = "tests";
  let overlaySignature = "";
  let activeViewSignature = "";
  let latestOverlayViews = [];
  let latestDashboard = null;
  let windowGesture = null;
  const listeners = new AbortController();
  const stop = () => {
    if (!contextValid) return;
    contextValid = false;
    if (metricsTimer !== null) clearInterval(metricsTimer);
    try { observer?.disconnect(); } catch (_) {}
    try { listeners.abort(); } catch (_) {}
    try { port?.disconnect(); } catch (_) {}
    try { overlayHost?.remove(); } catch (_) {}
  };
  window.__YA_GAMES_QA_CONTENT_CONTROLLER__ = { version: contentVersion, stop };
  try {
    port = chrome.runtime.connect({ name: "ya-games-qa-content" });
    port.onDisconnect.addListener(stop);
  } catch (_) { stop(); }
  const alive = () => contextValid && Boolean(port);
  const safeSend = (message) => {
    if (!alive()) return;
    try {
      port.postMessage(message);
    } catch (_) { stop(); }
  };

  const minimumWindowSize = (root) => {
    const head = root.querySelector(".head");
    const body = root.querySelector(".body");
    let width = 340;
    const context = document.createElement("canvas").getContext("2d");
    if (context) {
      context.font = "600 12px system-ui";
      for (const group of root.querySelectorAll(".actions, .toolbar, .dash-tabs")) {
        const buttons = [...group.children].filter((element) => element.tagName === "BUTTON");
        const columns = group.classList.contains("dash-tabs") ? 3 : group.classList.contains("single-action") || group.classList.contains("finished-actions") ? 1 : 2;
        const buttonWidth = Math.max(0, ...buttons.map((button) => context.measureText(button.textContent).width + 24));
        width = Math.max(width, buttonWidth * columns + (columns - 1) * 7 + 24);
      }
    }
    return { width: Math.ceil(width), height: Math.ceil(head.getBoundingClientRect().height + body.getBoundingClientRect().height + 14) };
  };

  const keepOverlayVisible = () => {
    if (!overlayHost?.isConnected || windowGesture) return;
    requestAnimationFrame(() => {
      if (!overlayHost?.isConnected || windowGesture) return;
      const root = overlayHost.shadowRoot;
      const box = root.querySelector(".box");
      const minimum = minimumWindowSize(root);
      box.style.minWidth = `${Math.min(minimum.width, Math.max(1, innerWidth - 20))}px`;
      box.style.minHeight = `${Math.min(minimum.height, Math.max(1, innerHeight - 20))}px`;
      const rect = overlayHost.getBoundingClientRect();
      const left = Math.max(4, Math.min(Math.max(4, innerWidth - Math.min(rect.width, innerWidth - 8) - 4), rect.left));
      const top = Math.max(4, Math.min(Math.max(4, innerHeight - Math.min(rect.height, innerHeight - 8) - 4), rect.top));
      overlayHost.style.right = "auto";
      overlayHost.style.bottom = "auto";
      overlayHost.style.left = `${left}px`;
      overlayHost.style.top = `${top}px`;
    });
  };
  window.addEventListener("resize", keepOverlayVisible, { signal: listeners.signal });

  const ensureOverlay = () => {
    if (overlayHost?.isConnected) return overlayHost.shadowRoot;
    overlayHost = document.createElement("div");
    overlayHost.id = "ya-games-qa-overlay";
    overlayHost.style.cssText = "all:initial;position:fixed;right:14px;bottom:14px;z-index:2147483647";
    const root = overlayHost.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      *{box-sizing:border-box}button,select{font:600 12px system-ui;border:0;border-radius:8px;padding:8px;color:#fff;background:#6654e8}button{cursor:pointer}button:hover{filter:brightness(1.1)}button:disabled{cursor:wait;opacity:.55;filter:none}
      .box{width:360px;height:auto;min-width:300px;min-height:110px;max-width:calc(100vw - 20px);max-height:calc(100vh - 20px);overflow:auto;resize:both;scrollbar-width:thin;scrollbar-color:#596171 transparent;background:#151820;color:#f5f7fb;border:1px solid #3a404c;border-radius:13px;box-shadow:0 14px 50px #000b;font:12px/1.4 system-ui}.box::-webkit-scrollbar,.picker-menu::-webkit-scrollbar,.dash-list::-webkit-scrollbar{width:4px}.box::-webkit-scrollbar-track,.picker-menu::-webkit-scrollbar-track,.dash-list::-webkit-scrollbar-track{background:transparent}.box::-webkit-scrollbar-thumb,.picker-menu::-webkit-scrollbar-thumb,.dash-list::-webkit-scrollbar-thumb{background:#596171;border-radius:8px}.box.finished{height:auto!important;min-height:0;overflow:hidden;resize:horizontal}
      .head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid #2b303b;cursor:move;user-select:none}.head b{font-size:13px}.head span{color:#67e39a;font-size:10px}
      .body{padding:10px}.list{display:grid;gap:5px}.test{display:flex;justify-content:space-between;width:100%;text-align:left;background:#242934}.test>*{pointer-events:none}.test i{font-style:normal;color:#9da5b3;font-size:10px}.test-head{display:flex;align-items:center;gap:9px;margin-bottom:8px}.back{flex:0 0 32px;width:32px;height:32px;padding:0;border-radius:50%;background:#292e39;font-size:18px;line-height:32px}.test-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.task{font-size:16px;font-weight:750;margin:8px 0 14px}.actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;align-items:start}.actions>*{min-width:0}.actions.single-action,.actions.finished-actions{display:flex;justify-content:center}.actions.single-action button,.actions.finished-actions button{width:170px;flex:none}.yes{background:#218b55}.no{background:#c64053}.bad{color:#ff8798!important}.good{color:#72e8a4!important}.neutral{color:#b9c0cc!important}.option-picker{min-width:0}.picker-toggle{width:100%;text-align:left;background:#292e39;border:1px solid #454c5a}.picker-toggle:after{content:"⌄";float:right;font-size:14px}.picker-menu{display:grid;grid-column:1/-1;gap:3px;max-height:220px;overflow:auto;scrollbar-width:thin;scrollbar-color:#596171 transparent;margin-top:5px;padding:5px;background:#1d212a;border:1px solid #454c5a;border-radius:9px}.picker-menu[hidden]{display:none}.picker-option{width:100%;text-align:left;background:#292e39}.picker-option.selected{background:#6654e8}
      .dashboard{display:grid;gap:8px;margin-bottom:10px}.connection{display:flex;justify-content:space-between;align-items:center;padding:9px;border-radius:9px;background:#20252e}.metrics{display:grid;grid-template-columns:1fr 1fr;gap:6px}.metric{padding:8px;border-radius:8px;background:#20252e}.metric small{display:block;color:#8f98a8}.metric b{display:block;font-size:16px;margin-top:3px}.dash-title{margin:3px 0 6px;color:#9fa7b5;font-size:10px;letter-spacing:.08em}.dash-list{display:grid;gap:4px;max-height:45vh;overflow:auto}.dash-row{padding:6px;border-radius:6px;background:#20252e;color:#bdc4cf;font:10px/1.3 ui-monospace,monospace}.dash-row.issue{border-left:3px solid #ef6075;background:#351d25;color:#ffd9df}.dash-row.issue b{display:block;color:#ff8798;margin-bottom:3px}.dash-row.issue small{display:block;color:#e6b9c0}.toolbar{display:grid;grid-template-columns:1fr 1fr;gap:6px}.toolbar button{background:#292e39}.toolbar .capture,.toolbar .report{grid-column:1/-1}.toolbar .report{background:#6654e8}.dash-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:2px}.dash-tab{padding:7px 4px;background:#242934;color:#aeb6c4;font-size:10px}.dash-tab.active{background:#6654e8;color:#fff}.empty-section{padding:16px;text-align:center;color:#8f98a8;background:#20252e;border-radius:8px}.test-title{margin:4px 0 7px;color:#9fa7b5;font-size:10px;letter-spacing:.08em}
      .guide{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0 14px}.example{position:relative;min-height:112px;padding:8px;border:2px solid;border-radius:10px;text-align:center;font:700 10px system-ui}.example.good-card{border-color:#35bd75;background:#123525}.example.bad-card{border-color:#df5266;background:#401c24}.mark{position:absolute;right:6px;top:4px;font-size:20px;line-height:1}.example svg{display:block;width:100%;height:70px;margin:8px auto 2px}.example small{display:block;color:#fff}.phone{fill:#303744;stroke:#8d96a5;stroke-width:2}.shade{fill:#555f70}.player{fill:#171a21;stroke:#ef6075;stroke-width:2}.line{stroke:#dce1e9;stroke-width:3;stroke-linecap:round}.okfill{fill:#55d98c}.badfill{fill:#ef6075}.whitefill{fill:#eef1f6}.mobile-card{display:grid;justify-items:center;gap:8px;margin:8px 0 14px;padding:12px;background:#20252e;border-radius:10px}.mobile-card img{width:190px;height:190px;padding:6px;background:#fff;border-radius:8px}.mobile-card a{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9db6ff;text-decoration:none}.mobile-card small{color:#9fa7b5}
    </style><div class="box"><div class="head"><div><b>ЯИ ТЕСТ</b> <span>● OVERLAY · v${contentVersion}</span></div></div><div class="body"></div></div>`;
    const box = root.querySelector(".box");
    const head = root.querySelector(".head");
    const body = root.querySelector(".body");
    const fitButton = document.createElement("button");
    fitButton.type = "button";
    fitButton.title = "Размер по содержимому";
    fitButton.setAttribute("aria-label", "Размер по содержимому");
    fitButton.style.cssText = "display:grid;place-items:center;flex:0 0 28px;width:28px;height:28px;padding:5px;background:#292e39";
    fitButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v5H3m13-5v5h5M3 16h5v5m13-5h-5v5"/><path d="m3 3 5 5m13-5-5 5M3 21l5-5m13 5-5-5"/></svg>';
    fitButton.addEventListener("mousedown", (event) => event.preventDefault());
    fitButton.addEventListener("click", () => {
      for (const property of ["width", "height", "min-width", "min-height", "overflow"]) box.style.removeProperty(property);
      box.scrollTop = 0;
      keepOverlayVisible();
    }, { signal: listeners.signal });
    head.append(fitButton);
    box.style.resize = "none";
    const grip = document.createElement("div");
    grip.title = "Изменить размер окна";
    grip.setAttribute("aria-label", "Изменить размер окна");
    grip.style.cssText = "position:absolute;right:0;bottom:0;width:26px;height:26px;cursor:nwse-resize;touch-action:none;z-index:2;background:linear-gradient(135deg,transparent 55%,#778297 56%,#778297 61%,transparent 62%,transparent 70%,#778297 71%,#778297 76%,transparent 77%);border-radius:0 0 12px 0";
    root.append(grip);
    head.style.touchAction = "none";
    const beginGesture = (event, mode, control) => {
      if (event.button !== 0 || windowGesture) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = box.getBoundingClientRect();
      windowGesture = { pointerId: event.pointerId, mode, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      overlayHost.style.right = "auto";
      overlayHost.style.bottom = "auto";
      overlayHost.style.left = `${rect.left}px`;
      overlayHost.style.top = `${rect.top}px`;
      control.setPointerCapture(event.pointerId);
    };
    const moveGesture = (event) => {
      const gesture = windowGesture;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (gesture.mode === "move") {
        overlayHost.style.left = `${Math.max(4, Math.min(Math.max(4, innerWidth - gesture.width - 4), gesture.left + dx))}px`;
        overlayHost.style.top = `${Math.max(4, Math.min(Math.max(4, innerHeight - gesture.height - 4), gesture.top + dy))}px`;
      } else {
        const minimum = minimumWindowSize(root);
        const maxWidth = Math.max(1, innerWidth - 20);
        const maxHeight = Math.max(1, innerHeight - 20);
        const width = Math.min(maxWidth, Math.max(Math.min(minimum.width, maxWidth), gesture.width + dx));
        box.style.minWidth = `${Math.min(minimum.width, maxWidth)}px`;
        box.style.setProperty("width", `${width}px`);
        const heightMinimum = Math.min(minimumWindowSize(root).height, maxHeight);
        const height = Math.min(maxHeight, Math.max(heightMinimum, gesture.height + dy));
        box.style.minHeight = `${heightMinimum}px`;
        box.style.setProperty("height", `${height}px`, "important");
        overlayHost.style.left = `${Math.max(4, Math.min(gesture.left, innerWidth - width - 4))}px`;
        overlayHost.style.top = `${Math.max(4, Math.min(gesture.top, innerHeight - height - 4))}px`;
        box.style.overflow = "auto";
      }
    };
    const finishGesture = (event) => {
      if (!windowGesture || windowGesture.pointerId !== event.pointerId) return;
      windowGesture = null;
      keepOverlayVisible();
    };
    for (const control of [head, grip]) {
      control.addEventListener("pointermove", moveGesture, { signal: listeners.signal });
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) control.addEventListener(type, finishGesture, { signal: listeners.signal });
    }
    grip.addEventListener("pointerdown", (event) => beginGesture(event, "resize", grip), { signal: listeners.signal });
    for (const type of ["pointerdown", "mousedown", "mouseup", "click", "keydown", "keyup"]) {
      box.addEventListener(type, (event) => event.stopPropagation());
    }
    head.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      beginGesture(event, "move", head);
    });
    (document.documentElement || document.body).append(overlayHost);
    keepOverlayVisible();
    return root;
  };

  const applyWorkspace = () => {
    const root = ensureOverlay();
    overlayHost.dataset.workspace = "true";
    return root;
  };

  const sendOverlayAction = (testId, action, payload) => {
    if (!alive()) return;
    overlayHost.style.visibility = "hidden";
    safeSend({ type: "TEST_ACTION", testId, action, payload });
    setTimeout(() => {
      if (overlayHost?.isConnected) overlayHost.style.visibility = "visible";
      try { window.focus(); } catch (_) {}
    }, action === "answer" || action === "reload" ? 900 : 120);
  };

  const guideMarkup = (visual) => {
    const icon = (kind, good) => {
      if (kind === "speakerOn") return icon("speaker", !good);
      if (kind === "play") return icon("pause", !good);
      const color = good ? "okfill" : "badfill";
      const icons = {
        speaker: `<svg viewBox="0 0 100 70"><path class="whitefill" d="M18 29h16l18-14v40L34 41H18z"/><path class="line" d="M62 25q14 10 0 20" fill="none"/>${good ? '<path class="badfill" d="M70 18l7 7 7-7 5 5-7 7 7 7-5 5-7-7-7 7-5-5 7-7-7-7z"/>' : '<path class="line" d="M70 16q24 19 0 38" fill="none"/>'}</svg>`,
        pause: `<svg viewBox="0 0 100 70"><rect x="22" y="12" width="56" height="46" rx="9" class="phone"/><${good ? 'path' : 'path'} class="${color}" d="${good ? 'M39 24h8v22h-8zm14 0h8v22h-8z' : 'M40 21l25 14-25 14z'}"/></svg>`,
        gift: `<svg viewBox="0 0 100 70"><rect x="24" y="28" width="52" height="32" rx="4" class="${color}"/><rect x="20" y="22" width="60" height="12" rx="4" class="whitefill"/><path class="phone" d="M48 60V22h5v38z"/><circle cx="40" cy="17" r="9" fill="none" class="line"/><circle cx="60" cy="17" r="9" fill="none" class="line"/></svg>`,
        save: `<svg viewBox="0 0 100 70"><path class="phone" d="M24 8h46l10 10v44H20V8z"/><rect x="32" y="12" width="32" height="17" class="whitefill"/><rect x="31" y="40" width="38" height="17" rx="4" class="${color}"/></svg>`,
        language: `<svg viewBox="0 0 100 70"><circle cx="50" cy="35" r="27" fill="none" class="line"/><path d="M23 35h54M50 8q-20 27 0 54M50 8q20 27 0 54" fill="none" class="line"/><circle cx="73" cy="51" r="12" class="${color}"/></svg>`,
        trophy: `<svg viewBox="0 0 100 70"><path class="${color}" d="M32 10h36v18q0 20-18 20T32 28z"/><path d="M32 17H19q0 20 20 20M68 17h13q0 20-20 20M50 48v10M34 62h32" fill="none" class="line"/></svg>`,
        text: `<svg viewBox="0 0 100 70"><rect x="13" y="10" width="74" height="50" rx="7" class="phone"/><path d="M25 24h50M25 35h42M25 46h47" class="line"/><circle cx="79" cy="55" r="11" class="${color}"/></svg>`
      };
      return icons[kind];
    };
    if (visual === "system-player") return `<div class="guide"><div class="example good-card"><b class="mark">✓</b><svg viewBox="0 0 100 70"><rect x="15" y="5" width="70" height="60" rx="9" class="phone"/><path class="shade" d="M15 14h70v22H15z"/><path class="line" d="M28 24h44"/></svg><small>GOOD: шторка без плеера</small></div><div class="example bad-card"><b class="mark">✕</b><svg viewBox="0 0 100 70"><rect x="15" y="5" width="70" height="60" rx="9" class="phone"/><path class="shade" d="M15 14h70v40H15z"/><rect x="22" y="22" width="56" height="24" rx="5" class="player"/><circle cx="35" cy="34" r="7" class="badfill"/><path class="line" d="M49 30h20M49 38h14"/></svg><small>FAIL: появился медиаплеер</small></div></div>`;
    const definitions = {
      "sound-muted": ["speaker", "GOOD: звук остановился", "FAIL: звук играет"],
      "sound-resumed": ["speakerOn", "GOOD: звук вернулся", "FAIL: звука нет"],
      "game-paused": ["pause", "GOOD: игра на паузе", "FAIL: игра продолжается"],
      "game-resumed": ["play", "GOOD: игра продолжилась", "FAIL: игра зависла"],
      "reward-result": ["gift", "GOOD: награда по callback", "FAIL: неверная награда"],
      "save-persisted": ["save", "GOOD: данные на месте", "FAIL: прогресс пропал"],
      "language-match": ["language", "GOOD: весь текст переведён", "FAIL: языки смешаны"],
      "leaderboard-visible": ["trophy", "GOOD: рейтинг и игроки видны", "FAIL: пусто или ошибка"],
      "text-readable": ["text", "GOOD: текст читается", "FAIL: текст обрезан"]
    };
    const definition = definitions[visual];
    if (!definition) return "";
    return `<div class="guide"><div class="example good-card"><b class="mark">✓</b>${icon(definition[0], true)}<small>${definition[1]}</small></div><div class="example bad-card"><b class="mark">✕</b>${icon(definition[0], false)}<small>${definition[2]}</small></div></div>`;
  };

  const renderOverlay = (views, dashboard = latestDashboard) => {
    latestOverlayViews = views;
    latestDashboard = dashboard;
    const root = ensureOverlay();
    const body = root.querySelector(".body");
    const box = root.querySelector(".box");
    box.classList.remove("finished");
    body.replaceChildren();
    const selected = views.find((view) => view.id === activeOverlayTest);
    activeViewSignature = selected ? JSON.stringify(selected) : "";
    if (!selected) {
      if (dashboard) {
        const dash = document.createElement("div");
        dash.className = "dashboard";
        const mb = (bytes) => `${(Number(bytes || 0) / 1024 / 1024).toFixed(bytes > 10 * 1024 * 1024 ? 1 : 2)} МБ`;
        const connection = document.createElement("div");
        connection.className = "connection";
        const versionMismatch = dashboard.version !== contentVersion;
        const connectionText = versionMismatch ? "● ОБНОВИ РАСШИРЕНИЕ" : dashboard.sdkConnected ? "● SDK LIVE" : dashboard.connected ? "● ИГРА НАЙДЕНА · SDK WAIT" : dashboard.platformAd ? "● ПРЕРОЛЛ ЯНДЕКСА" : "● WAIT";
        const connectionTone = versionMismatch ? "bad" : dashboard.sdkConnected ? "good" : dashboard.connected || dashboard.platformAd ? "neutral" : "bad";
        connection.innerHTML = `<b>ПОДКЛЮЧЕНИЕ</b><span class="${connectionTone}">${connectionText}</span>`;
        const metrics = document.createElement("div");
        metrics.className = "metrics";
        const values = [["GAME READY", dashboard.readyMs == null ? "WAIT" : `${(dashboard.readyMs / 1000).toFixed(2)} с`], ["SDK INIT", dashboard.sdkInitialized == null ? "—" : `${(dashboard.sdkInitialized / 1000).toFixed(2)} с`], ["ЗАГРУЗКА", mb(dashboard.transferBytes)], ["ЗАПРОСЫ", dashboard.requests]];
        for (const [label, value] of values) {
          const metric = document.createElement("div");
          metric.className = "metric";
          metric.innerHTML = `<small>${label}</small><b>${value}</b>`;
          metrics.append(metric);
        }
        dash.append(connection, metrics);
        const toolbar = document.createElement("div");
        toolbar.className = "toolbar";
        const controls = [
          ["Снимок", "CAPTURE", { label: "Ручной снимок" }, "capture"],
          ["Сбросить", "RESET"],
          ["Перезагрузить", "RELOAD_GAME"]
        ];
        for (const [label, type, extra = {}, className = ""] of controls) {
          const button = document.createElement("button");
          button.className = className;
          button.textContent = label;
          button.addEventListener("mousedown", (event) => event.preventDefault());
          button.addEventListener("click", () => {
            if (type === "CAPTURE") {
              overlayHost.style.visibility = "hidden";
              safeSend({ type, ...extra });
              setTimeout(() => { if (overlayHost?.isConnected) overlayHost.style.visibility = "visible"; }, 900);
              return;
            }
            safeSend({ type, ...extra });
          });
          toolbar.append(button);
        }
        if (dashboard.hasReport) {
          const report = document.createElement("button");
          report.className = "report";
          report.textContent = `Скачать отчёт · ${dashboard.completedCount}`;
          report.addEventListener("mousedown", (event) => event.preventDefault());
          report.addEventListener("click", () => safeSend({ type: "EXPORT_REPORT" }));
          toolbar.append(report);
        }
        dash.append(toolbar);
        const tabs = document.createElement("div");
        tabs.className = "dash-tabs";
        const tabItems = [
          ["tests", "ПРОВЕРКИ"],
          ["warnings", `ПРЕДУПР. ${dashboard.warnings?.length || 0}`],
          ["logs", `ЛОГИ ${dashboard.events?.length || 0}`]
        ];
        for (const [id, label] of tabItems) {
          const tab = document.createElement("button");
          tab.className = `dash-tab${activeDashboardSection === id ? " active" : ""}`;
          tab.textContent = label;
          tab.addEventListener("mousedown", (event) => event.preventDefault());
          tab.addEventListener("click", () => { activeDashboardSection = id; renderOverlay(latestOverlayViews, latestDashboard); });
          tabs.append(tab);
        }
        dash.append(tabs);
        if (activeDashboardSection === "tests" && dashboard.issues?.length) {
          const title = document.createElement("div"); title.className = "dash-title bad"; title.textContent = `ISSUES ${dashboard.issues.length}`;
          const list = document.createElement("div"); list.className = "dash-list";
          for (const issue of dashboard.issues) {
            const row = document.createElement("div"); row.className = "dash-row issue";
            const name = document.createElement("b"); name.textContent = issue.title;
            row.append(name);
            for (const detail of issue.details || []) { const line = document.createElement("small"); line.textContent = detail; row.append(line); }
            list.append(row);
          }
          dash.append(title, list);
        }
        if (activeDashboardSection === "warnings" && dashboard.warnings?.length) {
          const title = document.createElement("div"); title.className = "dash-title"; title.textContent = `ПРЕДУПРЕЖДЕНИЯ ${dashboard.warnings.length}`;
          const list = document.createElement("div"); list.className = "dash-list";
          for (const warning of dashboard.warnings) { const row = document.createElement("div"); row.className = "dash-row"; row.textContent = `${String(warning.level || "warn").toUpperCase()} — ${warning.text}`; list.append(row); }
          dash.append(title, list);
        } else if (activeDashboardSection === "warnings") {
          const empty = document.createElement("div"); empty.className = "empty-section"; empty.textContent = "Предупреждений нет"; dash.append(empty);
        }
        if (activeDashboardSection === "logs" && dashboard.events?.length) {
          const title = document.createElement("div"); title.className = "dash-title"; title.textContent = "SDK LOG";
          const list = document.createElement("div"); list.className = "dash-list";
          for (const entry of dashboard.events) { const row = document.createElement("div"); row.className = "dash-row"; row.textContent = entry.details?.method || entry.event; list.append(row); }
          dash.append(title, list);
        } else if (activeDashboardSection === "logs") {
          const empty = document.createElement("div"); empty.className = "empty-section"; empty.textContent = "Вызовов SDK пока нет"; dash.append(empty);
        }
        body.append(dash);
      }
      if (activeDashboardSection !== "tests") return;
      const testsTitle = document.createElement("div"); testsTitle.className = "test-title"; testsTitle.textContent = "ПРОВЕРКИ";
      body.append(testsTitle);
      const list = document.createElement("div");
      list.className = "list";
      for (const view of views) {
        const button = document.createElement("button");
        button.className = "test";
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => { activeOverlayTest = view.id; renderOverlay(latestOverlayViews, latestDashboard); });
        const title = document.createElement("span");
        title.textContent = view.title;
        const status = document.createElement("i");
        status.className = view.tone || "neutral";
        status.textContent = view.status;
        button.append(title, status);
        list.append(button);
      }
      body.append(list);
      return;
    }
    const finished = selected.complete || ["GOOD", "FAIL", "SKIP"].includes(selected.status);
    box.classList.toggle("finished", finished);
    const back = document.createElement("button");
    back.className = "back";
    back.textContent = "←";
    back.title = "Все проверки";
    back.setAttribute("aria-label", "Все проверки");
    back.addEventListener("mousedown", (event) => event.preventDefault());
    back.addEventListener("click", () => { activeOverlayTest = null; renderOverlay(latestOverlayViews, latestDashboard); });
    const title = document.createElement("b");
    title.textContent = `${selected.title} — ${selected.status}`;
    title.className = `test-name ${selected.tone || "neutral"}`;
    const task = document.createElement("div");
    task.className = "task";
    task.textContent = selected.instruction;
    const guide = document.createElement("div");
    guide.innerHTML = selected.visual ? guideMarkup(selected.visual) : "";
    const mobileCard = document.createElement("div");
    if (selected.qrUrl && selected.mobileUrl) {
      mobileCard.className = "mobile-card";
      const qr = document.createElement("img");
      qr.src = selected.qrUrl;
      qr.alt = "QR-код игры";
      const hint = document.createElement("small");
      hint.textContent = "Наведи камеру телефона";
      const link = document.createElement("a");
      link.href = selected.mobileUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = selected.mobileUrl;
      mobileCard.append(qr, hint, link);
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    if (finished && selected.id !== "language") actions.classList.add("finished-actions");
    const selectedActions = finished && selected.id === "language"
      ? [{ label: "Проверить ещё язык", action: "another" }, { label: "Готово", action: "__done" }]
      : finished ? [{ label: "Готово", action: "__done" }] : (selected.actions || []);
    if (!finished && selectedActions.length === 1 && !Array.isArray(selectedActions[0]?.options)) actions.classList.add("single-action");
    for (const action of selectedActions) {
      let selectedValue = null;
      let optionMenu = null;
      if (Array.isArray(action.options)) {
        selectedValue = action.options[0]?.value ?? null;
        const picker = document.createElement("div");
        picker.className = "option-picker";
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "picker-toggle";
        toggle.textContent = action.options[0]?.label || "Выбрать";
        const menu = document.createElement("div");
        optionMenu = menu;
        menu.className = "picker-menu";
        menu.hidden = true;
        toggle.addEventListener("mousedown", (event) => event.preventDefault());
        toggle.addEventListener("click", (event) => { event.stopPropagation(); menu.hidden = !menu.hidden; });
        for (const option of action.options) {
          const item = document.createElement("button");
          item.type = "button";
          item.className = `picker-option${option.value === selectedValue ? " selected" : ""}`;
          item.textContent = option.label;
          item.addEventListener("mousedown", (event) => event.preventDefault());
          item.addEventListener("click", (event) => {
            event.stopPropagation();
            selectedValue = option.value;
            toggle.textContent = option.label;
            for (const button of menu.querySelectorAll(".picker-option")) button.classList.toggle("selected", button === item);
            menu.hidden = true;
          });
          menu.append(item);
        }
        picker.append(toggle);
        actions.append(picker);
      }
      const button = document.createElement("button");
      button.textContent = action.label;
      if (action.tone) button.className = action.tone;
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        if (action.action === "__done") {
          activeOverlayTest = null;
          renderOverlay(latestOverlayViews, latestDashboard);
          return;
        }
        for (const control of actions.querySelectorAll("button")) control.disabled = true;
        button.textContent = "Подождите…";
        sendOverlayAction(selected.id, action.action, { ...(action.payload || {}), ...(selectedValue !== null ? { value: selectedValue } : {}) });
      });
      actions.append(button);
      if (optionMenu) actions.append(optionMenu);
    }
    if (finished) body.append(title, task, actions);
    else {
      const testHead = document.createElement("div");
      testHead.className = "test-head";
      testHead.append(back, title);
      body.append(testHead, guide, task);
      if (selected.qrUrl) body.append(mobileCard);
      body.append(actions);
    }
    keepOverlayVisible();
  };

  port?.onMessage.addListener((message) => {
    if (message?.type !== "OVERLAY_STATE") return;
    if (!message.enabled) {
      overlayHost?.remove();
      overlayHost = null;
      return;
    }
    const views = Array.isArray(message.views) ? message.views : [];
    const dashboard = message.dashboard || null;
    latestOverlayViews = views;
    latestDashboard = dashboard;
    if (activeOverlayTest && overlayHost?.isConnected) {
      const nextSelected = views.find((view) => view.id === activeOverlayTest);
      const nextViewSignature = nextSelected ? JSON.stringify(nextSelected) : "";
      if (nextViewSignature === activeViewSignature) return;
    }
    const signature = JSON.stringify({ views, dashboard });
    if (signature === overlaySignature && overlayHost?.isConnected) return;
    overlaySignature = signature;
    const mount = () => {
      renderOverlay(views, dashboard);
    };
    if (document.documentElement) mount();
    else document.addEventListener("readystatechange", mount, { once: true, signal: listeners.signal });
  });

  safeSend({
    type: "CONTENT_READY",
    frameUrl: location.href,
    isTop: window === window.top
  });

  const collect = () => {
    const entries = performance.getEntriesByType("resource");
    const metrics = entries.reduce((sum, entry) => {
      sum.requests += 1;
      sum.transferBytes += entry.transferSize || 0;
      sum.decodedBytes += entry.decodedBodySize || 0;
      return sum;
    }, { requests: 0, transferBytes: 0, decodedBytes: 0 });
    const origins = [...new Set(entries.map((entry) => {
      try { return new URL(entry.name).origin; } catch (_) { return null; }
    }).filter((origin) => origin && origin !== "null"))];
    const largest = entries.map((entry) => ({
      url: entry.name,
      bytes: entry.decodedBodySize || entry.transferSize || 0
    })).sort((a, b) => b.bytes - a.bytes).slice(0, 8);
    metrics.origins = origins;
    metrics.largest = largest;
    safeSend({ type: "METRICS", frameUrl: location.href, metrics });
    if (window === window.top) {
      const gameFrame = [...document.querySelectorAll("iframe[src]")].find((frame) => {
        try { return /^app-\d+\.(?:games\.s3|cdn\.games)\.yandex\.net$/.test(new URL(frame.src).hostname); }
        catch (_) { return false; }
      });
      if (gameFrame?.src) safeSend({ type: "CONTENT_READY", frameUrl: gameFrame.src, isTop: false, discoveredBy: "top-frame-scan" });
      const fullscreenMarker = [...document.querySelectorAll('[class*="fullscreen-adv"], [class*="fullscreenAdv"]')].some((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > innerWidth * 0.4 && rect.height > innerHeight * 0.4;
      });
      const largeSafeFrame = [...document.querySelectorAll('iframe[src*="safeframe"], iframe[src*="yastatic.net/safeframe"]')].some((frame) => {
        const rect = frame.getBoundingClientRect();
        return rect.width > innerWidth * 0.4 && rect.height > innerHeight * 0.4;
      });
      const platformAd = fullscreenMarker || largeSafeFrame;
      safeSend({ type: "PLATFORM_STATE", platformAd });
    }
  };

  window.addEventListener("message", (event) => {
    if (event.data?.source !== "YA_GAMES_LOAD_AUDITOR") return;
    if (event.source !== window) {
      let trustedGameFrame = false;
      try { trustedGameFrame = /^app-\d+\.(?:games\.s3|cdn\.games)\.yandex\.net$/.test(new URL(event.data.frameUrl).hostname); }
      catch (_) {}
      if (!trustedGameFrame) return;
    }
    safeSend({ type: "SDK_EVENT", ...event.data });
  }, { signal: listeners.signal });

  if (window === window.top) {
    const sendMeta = () => safeSend({
      type: "PAGE_META",
      url: location.href,
      title: document.title
    });
    document.addEventListener("DOMContentLoaded", sendMeta, { once: true, signal: listeners.signal });
    window.addEventListener("load", sendMeta, { once: true, signal: listeners.signal });
  }

  observer = new PerformanceObserver(() => { if (alive()) collect(); });
  observer.observe({ type: "resource", buffered: true });
  window.addEventListener("load", collect, { once: true, signal: listeners.signal });
  metricsTimer = setInterval(() => {
    if (!alive()) return;
    collect();
  }, 1000);
})();
