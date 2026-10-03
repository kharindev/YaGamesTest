import { tests, testById } from "./checks/registry.mjs";

const EXTENSION_VERSION = chrome.runtime.getManifest().version;

const tabRuns = new Map();
const queues = new Map();
const contentPorts = new Map();
const isYandexGamesUrl = (value = "") => {
  try {
    const url = new URL(value);
    return /(^|\.)yandex\.(ru|com)$/.test(url.hostname) && url.pathname.startsWith("/games/");
  } catch (_) { return false; }
};
const runKey = (tabId) => `ya-test-run-${tabId}`;
const gameIdentity = (value = "") => {
  try {
    const url = new URL(value);
    const hostedId = url.hostname.match(/^app-(\d+)\.(?:games\.s3|cdn\.games)\.yandex\.net$/)?.[1];
    if (hostedId) return `game:${hostedId}`;
    const path = url.pathname.replace(/\/+$/, "");
    const id = path.match(/(?:-|\/)(\d+)$/)?.[1];
    return id ? `game:${id}` : `${url.hostname}${path}`;
  } catch (_) { return ""; }
};
const isHostedGameFrame = (value = "") => {
  try {
    const host = new URL(value).hostname;
    return /^app-\d+\.games\.s3\.yandex\.net$/.test(host) || /^app-\d+\.cdn\.games\.yandex\.net$/.test(host);
  } catch (_) { return false; }
};
const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
const visualFor = (id, phase) => ({
  "audio:ask-system-player": "system-player",
  "audio:ask-muted": "sound-muted",
  "audio:ask-resumed": "sound-resumed",
  "rewarded:ask-muted": "sound-muted",
  "rewarded:ask-paused": "game-paused",
  "rewarded:ask-reward": "reward-result",
  "rewarded:ask-resumed": "game-resumed",
  "rewarded:ask-sound-returned": "sound-resumed",
  "interstitial:ask-muted": "sound-muted",
  "interstitial:ask-paused": "game-paused",
  "interstitial:ask-resumed": "game-resumed",
  "interstitial:ask-sound-returned": "sound-resumed",
  "save:waiting-answer": "save-persisted",
  "purchases:cancel-ask-game": "game-resumed",
  "purchases:cancel-ask-no-reward": "reward-result",
  "purchases:normal-ask-reward": "reward-result",
  "purchases:restore-ask-reward": "reward-result",
  "language:ask-visible": "language-match",
  "leaderboard:ask-visible": "leaderboard-visible",
  "textAudit:review": "text-readable"
})[`${id}:${phase}`] || null;
const loaded = chrome.storage.local.get(null).then((saved) => {
  for (const [key, value] of Object.entries(saved)) {
    if (key.startsWith("ya-test-run-") && value?.tabId && !tabRuns.has(value.tabId)) {
      tabRuns.set(value.tabId, normalizeRun(value, value.tabId));
    }
  }
});

function emptyRun(tabId) {
  return {
    tabId, startedAt: Date.now(), url: "", title: "", ready: null,
    sdkInitialized: null, gameFrameUrl: null, gameFrameId: null, platformAd: false,
    audio: { detected: false, active: false, kind: null, state: "unknown" },
    network: { requests: 0, transferBytes: 0, decodedBytes: 0 },
    frames: {}, screenshots: [], events: [], warnings: [], gameplayState: null,
    connection: { contentFrames: {}, monitorFrames: {} },
    recentEventIds: [],
    tests: Object.fromEntries(tests.map((test) => [test.id, test.initial()]))
  };
}

function normalizeRun(run, tabId) {
  const clean = emptyRun(tabId);
  return {
    ...clean, ...run, tabId,
    network: { ...clean.network, ...(run?.network || {}) },
    frames: run?.frames || {}, screenshots: run?.screenshots || [],
    events: run?.events || [], warnings: run?.warnings || [], gameplayState: run?.gameplayState || null,
    audio: { ...clean.audio, ...(run?.audio || {}) },
    connection: {
      contentFrames: run?.connection?.contentFrames || {},
      monitorFrames: run?.connection?.monitorFrames || {}
    },
    tests: Object.fromEntries(tests.map((test) => [test.id, { ...test.initial(), ...(run?.tests?.[test.id] || {}) }]))
  };
}

function addWarning(run, code, level, text) {
  const existing = run.warnings.find((item) => item.code === code);
  if (existing) {
    existing.level = level;
    existing.text = text;
    existing.at = Date.now();
    return;
  }
  run.warnings.push({ code, level, text, at: Date.now() });
}

function recordEvent(run, message) {
  run.events.push({
    event: message.event,
    elapsedMs: message.elapsedMs,
    at: Date.now(),
    details: Object.fromEntries(Object.entries(message).filter(([key]) => !["type", "source", "frameUrl", "event", "elapsedMs"].includes(key)))
  });
  if (run.events.length > 200) run.events.splice(0, run.events.length - 200);
}

function getRun(tabId) {
  if (!tabRuns.has(tabId)) tabRuns.set(tabId, emptyRun(tabId));
  return tabRuns.get(tabId);
}

function resetPageSession(run) {
  run.ready = null;
  run.sdkInitialized = null;
  run.gameFrameUrl = null;
  run.gameFrameId = null;
  run.platformAd = false;
  run.network = { requests: 0, transferBytes: 0, decodedBytes: 0 };
  run.frames = {};
  run.events = [];
  run.warnings = [];
  run.gameplayState = null;
  run.audio = { detected: false, active: false, kind: null, state: "unknown" };
  run.connection = { contentFrames: {}, monitorFrames: {} };
}

async function detachDebugger(tabId) {
  try { await chrome.debugger.detach({ tabId }); } catch (_) {}
}

async function commit(tabId, persist = true) {
  const state = getRun(tabId);
  if (persist) await chrome.storage.local.set({ [runKey(tabId)]: state });
  chrome.runtime.sendMessage({ type: "STATE", state }).catch(() => {});
  const framePorts = contentPorts.get(tabId);
  if (framePorts) {
    const views = tests.map((test) => {
      const testState = state.tests?.[test.id] || test.initial();
      const view = test.view(testState);
      const complete = testState.phase === "complete";
      return { id: test.id, title: test.title, status: view.status, tone: view.tone, instruction: view.instruction, visual: visualFor(test.id, testState.phase), mobileUrl: view.mobileUrl || null, qrUrl: view.qrUrl || null, complete, actions: complete ? [{ label: "Готово", action: "__done" }] : view.actions };
    });
    const completed = tests.map((test) => {
      const testState = state.tests?.[test.id] || test.initial();
      const view = test.view(testState);
      return { id: test.id, title: test.title, result: testState.result, report: view.report || [] };
    }).filter((item) => item.result);
    const issues = completed.filter((item) => item.result === "fail").map((item) => ({
      source: item.title, title: `${item.title} — FAIL`, details: item.report
    }));
    for (const [frameId, ports] of framePorts) {
      for (const port of ports) {
        const dashboard = {
          version: EXTENSION_VERSION,
          connected: Boolean(state.gameFrameUrl),
          sdkConnected: state.sdkInitialized !== null,
          platformAd: Boolean(state.platformAd && !state.gameFrameUrl),
          audio: state.audio,
          sdkInitialized: state.sdkInitialized,
          readyMs: state.ready?.elapsedMs ?? null,
          requests: state.network?.requests || 0,
          transferBytes: state.network?.transferBytes || 0,
          decodedBytes: state.network?.decodedBytes || 0,
          warnings: (state.warnings || []).slice(-5),
          events: (state.events || []).slice(-8).reverse(),
          issues,
          hasReport: completed.length > 0,
          completedCount: completed.length
        };
        try { port.postMessage({ type: "OVERLAY_STATE", enabled: frameId === 0, workspace: frameId === 0, views, dashboard }); } catch (_) {}
      }
    }
  }
}

async function capture(tabId, label) {
  const tab = await chrome.tabs.get(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const shot = { dataUrl, at: Date.now(), label };
  getRun(tabId).screenshots.push(shot);
  return shot;
}

function context(tabId) {
  return {
    capture: (label) => capture(tabId, label),
    persist: () => commit(tabId),
    reload: async () => {
      const run = getRun(tabId);
      resetPageSession(run);
      await chrome.storage.local.set({ [runKey(tabId)]: run });
      await chrome.tabs.reload(tabId, { bypassCache: true });
    },
    gameFrameUrl: getRun(tabId).gameFrameUrl,
    pageUrl: getRun(tabId).url,
    makeQr: async (value) => {
      const remote = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(value)}`;
      try {
        const response = await fetch(remote);
        if (!response.ok) throw new Error(`QR HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = "";
        for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        return `data:image/png;base64,${btoa(binary)}`;
      } catch (_) { return remote; }
    },
    setLanguage: async (lang, locale) => {
      const target = { tabId };
      try { await chrome.debugger.attach(target, "1.3"); }
      catch (error) { if (!String(error).includes("already attached")) throw error; }
      await chrome.debugger.sendCommand(target, "Emulation.setLocaleOverride", { locale });
      await chrome.debugger.sendCommand(target, "Network.enable");
      await chrome.debugger.sendCommand(target, "Network.setExtraHTTPHeaders", {
        headers: { "Accept-Language": `${locale},${lang};q=0.9` }
      });
      const tab = await chrome.tabs.get(tabId);
      const url = new URL(tab.url);
      url.searchParams.set("lang", lang);
      setTimeout(() => chrome.tabs.update(tabId, { url: url.toString() }), 150);
      const requestedLang = lang;
      setTimeout(() => { enqueue(tabId, async () => {
        const state = getRun(tabId);
        const language = state.tests?.language;
        if (language?.phase !== "reloading" || language.requestedLang !== requestedLang) return;
        language.phase = "language-result";
        language.result = "fail";
        language.error = `SDK не вернул язык ${requestedLang} за 20 секунд`;
        language.checks = [...(language.checks || []).filter((item) => item.lang !== requestedLang), { lang: requestedLang, sdkLang: language.sdkLang, translated: false, shot: null }];
        await commit(tabId);
      }).catch(() => {}); }, 20000);
    },
    setViewport: async ({ width, height, mobile }) => {
      const target = { tabId };
      try { await chrome.debugger.attach(target, "1.3"); }
      catch (error) { if (!String(error).includes("already attached")) throw error; }
      await chrome.debugger.sendCommand(target, "Emulation.setDeviceMetricsOverride", {
        width, height, deviceScaleFactor: 1, mobile: Boolean(mobile), screenWidth: width, screenHeight: height
      });
      await chrome.debugger.sendCommand(target, "Emulation.setTouchEmulationEnabled", { enabled: Boolean(mobile), maxTouchPoints: mobile ? 5 : 1 });
    },
    resetViewport: async () => {
      const target = { tabId };
      try { await chrome.debugger.sendCommand(target, "Emulation.clearDeviceMetricsOverride"); } catch (_) {}
      try { await chrome.debugger.sendCommand(target, "Emulation.setTouchEmulationEnabled", { enabled: false }); } catch (_) {}
    },
    scanText: async () => {
      const frameId = getRun(tabId).gameFrameId;
      if (!Number.isInteger(frameId)) throw new Error("Игровой iframe не найден");
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        func: () => {
          const selectors = "h1,h2,h3,h4,h5,h6,p,span,label,button,a,li,input,textarea,[role=button],[aria-label]";
          const values = [];
          let overflowCount = 0;
          for (const element of document.querySelectorAll(selectors)) {
            if (element.closest("#ya-games-qa-overlay")) continue;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || rect.width === 0 || rect.height === 0) continue;
            const value = (element.innerText || element.value || element.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
            if (!value || value.length > 300) continue;
            values.push(value);
            if (element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2) overflowCount++;
          }
          const unique = [...new Set(values)];
          const suspiciousPattern = /\b(undefined|null|nan|lorem ipsum|todo|debug|missing translation)\b|\{\{[^}]+\}\}|\[missing[^\]]*\]/i;
          return {
            count: unique.length,
            overflowCount,
            suspicious: unique.filter((value) => suspiciousPattern.test(value)).slice(0, 20),
            samples: unique.slice(0, 20)
          };
        }
      });
      return execution?.result || { count: 0, overflowCount: 0, suspicious: [], samples: [] };
    },
    auditModeration: async () => {
      const run = getRun(tabId);
      const checks = [
        { id: "sdk", label: "SDK Яндекс Игр подключён", status: run.sdkInitialized !== null ? "good" : "fail", detail: run.sdkInitialized !== null ? `${run.sdkInitialized} мс` : "YaGames.init не обнаружен" },
        { id: "ready", label: "Game Ready вызван", status: run.ready ? "good" : "fail", detail: run.ready ? `${run.ready.elapsedMs} мс` : "LoadingAPI.ready не вызван" },
        { id: "https", label: "Игра работает по HTTPS", status: /^https:\/\//.test(run.gameFrameUrl || run.url) ? "good" : "fail", detail: run.gameFrameUrl || run.url || "URL неизвестен" },
        { id: "errors", label: "Нет JavaScript-ошибок", status: run.warnings.some((item) => String(item.code).startsWith("page-error:")) ? "fail" : "good", detail: run.warnings.filter((item) => String(item.code).startsWith("page-error:")).map((item) => item.text).join("; ") || "Ошибок не поймано" }
      ];
      if (Number.isInteger(run.gameFrameId)) {
        const [execution] = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [run.gameFrameId] },
          func: () => {
            const origin = location.origin;
            const externalLinks = [...document.querySelectorAll("a[href]")].map((link) => link.href).filter((href) => {
              try { const url = new URL(href); return /^https?:$/.test(url.protocol) && url.origin !== origin && !/(^|\.)yandex\.(ru|com|net)$/.test(url.hostname); } catch (_) { return false; }
            });
            const visibleText = (document.body?.innerText || "").slice(0, 200000);
            const suspicious = visibleText.match(/\b(undefined|null|nan|lorem ipsum|todo|missing translation)\b|\{\{[^}]+\}\}|\[missing[^\]]*\]/gi) || [];
            const root = document.documentElement;
            return { externalLinks: [...new Set(externalLinks)].slice(0, 10), suspicious: [...new Set(suspicious)].slice(0, 10), horizontalOverflow: root.scrollWidth > root.clientWidth + 4 };
          }
        });
        const dom = execution?.result || {};
        checks.push(
          { id: "external", label: "Нет внешних ссылок", status: dom.externalLinks?.length ? "fail" : "good", detail: dom.externalLinks?.join(", ") || "Внешних ссылок не найдено" },
          { id: "placeholders", label: "Нет технических заглушек в тексте", status: dom.suspicious?.length ? "fail" : "good", detail: dom.suspicious?.join(", ") || "Заглушек не найдено" },
          { id: "overflow", label: "Нет горизонтального переполнения", status: dom.horizontalOverflow ? "fail" : "good", detail: dom.horizontalOverflow ? "Страница шире игрового iframe" : "Размер интерфейса в границах iframe" }
        );
      }
      return checks;
    }
  };
}

async function handle(tabId, message) {
  let run = getRun(tabId);
  if (message.type === "GET_STATE") return { state: run };
  if (message.type === "RELOAD_GAME") {
    resetPageSession(run);
    await commit(tabId);
    await chrome.tabs.reload(tabId, { bypassCache: true });
    return { ok: true };
  }
  if (message.type === "EXPORT_REPORT") {
    const rows = tests.map((test) => {
      const testState = run.tests?.[test.id] || test.initial();
      if (!testState.result) return "";
      const view = test.view(testState);
      return `<section class="${escapeHtml(testState.result)}"><h2>${escapeHtml(test.title)} — ${escapeHtml(String(testState.result).toUpperCase())}</h2>${(view.report || []).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</section>`;
    }).join("");
    const issues = tests.flatMap((test) => {
      const testState = run.tests?.[test.id];
      if (testState?.result !== "fail") return [];
      const view = test.view(testState);
      return [`<li><b>${escapeHtml(test.title)}</b>${(view.report || []).map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</li>`];
    }).join("") || "<li>Issues отсутствуют</li>";
    const warnings = (run.warnings || []).map((item) => `<li><b>${escapeHtml(String(item.level || "warn").toUpperCase())}</b> — ${escapeHtml(item.text)}</li>`).join("") || "<li>Предупреждений нет</li>";
    const screenshots = (run.screenshots || []).filter((shot) => /^data:image\/(png|jpeg);base64,/i.test(shot?.dataUrl || "")).map((shot) =>
      `<figure><img src="${shot.dataUrl}" alt="${escapeHtml(shot.label || "Снимок")}"><figcaption>${escapeHtml(shot.label || "Снимок")} · ${new Date(shot.at).toLocaleString("ru-RU")}</figcaption></figure>`
    ).join("") || "<p>Снимков нет</p>";
    const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>ЯИ Тест — отчёт</title><style>body{font:14px system-ui;max-width:1100px;margin:30px auto;padding:0 20px;color:#171923}section{border:1px solid #ddd;border-radius:12px;padding:15px;margin:12px 0}.good{border-left:5px solid #25a964}.fail{border-left:5px solid #d64055}.skip{border-left:5px solid #d49b27}li{margin:12px 0}p{margin:5px 0;color:#4b5563}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.summary b{display:block;font-size:18px}.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}.shots figure{margin:0;border:1px solid #ddd;border-radius:10px;overflow:hidden}.shots img{display:block;width:100%;height:auto}.shots figcaption{padding:8px;color:#4b5563}@media(max-width:650px){.summary{grid-template-columns:1fr 1fr}}</style><h1>ЯИ Тест — QA отчёт</h1><p>${escapeHtml(run.title || "Игра")} · ${escapeHtml(run.url || "")} · ${new Date().toLocaleString("ru-RU")}</p><section class="summary"><div>Game Ready<b>${run.ready ? `${(run.ready.elapsedMs / 1000).toFixed(2)} с` : "WAIT"}</b></div><div>SDK init<b>${run.sdkInitialized == null ? "—" : `${(run.sdkInitialized / 1000).toFixed(2)} с`}</b></div><div>Загрузка<b>${(Number(run.network?.transferBytes || 0) / 1024 / 1024).toFixed(2)} МБ</b></div><div>Запросы<b>${Number(run.network?.requests || 0)}</b></div></section><h2>Issues</h2><ul>${issues}</ul><h2>Предупреждения</h2><ul>${warnings}</ul>${rows}<h2>Снимки</h2><div class="shots">${screenshots}</div></html>`;
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await chrome.downloads.download({ url, filename: `ya-test-report-${new Date().toISOString().replace(/[:.]/g, "-")}.html`, saveAs: true });
    return { ok: true };
  }
  if (message.type === "FOCUS_GAME") {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        try { window.focus(); } catch (_) {}
        const target = document.querySelector("canvas, iframe, [tabindex]");
        try { target?.focus?.({ preventScroll: true }); } catch (_) {}
      }
    });
    return { ok: true };
  }
  if (message.type === "ATTACH") {
    const results = await Promise.allSettled([
      chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] }),
      chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["page-monitor.js"], world: "MAIN" })
    ]);
    return { ok: results.some((item) => item.status === "fulfilled") };
  }
  if (message.type === "RESET") {
    await detachDebugger(tabId);
    tabRuns.set(tabId, emptyRun(tabId));
    await commit(tabId);
    return { ok: true };
  }
  if (message.type === "CLEAR_EVENTS") {
    run.events = [];
    await commit(tabId);
    return { ok: true };
  }
  if (message.type === "TEST_ACTION") {
    const test = testById.get(message.testId);
    if (!test) return { ok: false, error: "Unknown test" };
    run.tests[test.id] = await test.action(run.tests[test.id], message.action, message.payload, context(tabId));
    await commit(tabId);
    return { ok: true };
  }
  if (message.type === "CONTENT_READY") {
    run.connection.contentFrames[message.frameUrl] = { isTop: message.isTop, at: Date.now() };
    if (!message.isTop && isHostedGameFrame(message.frameUrl)) {
      run.gameFrameUrl = message.frameUrl;
      if (Number.isInteger(message.frameId)) run.gameFrameId = message.frameId;
      if (run.frames[message.frameUrl]) run.network = run.frames[message.frameUrl];
    }
    await commit(tabId);
    return { ok: true };
  }
  if (message.type === "PLATFORM_STATE") {
    run.platformAd = Boolean(message.platformAd);
  } else if (message.type === "PAGE_META") {
    const previousGame = gameIdentity(run.url);
    const nextGame = gameIdentity(message.url);
    if (previousGame && nextGame && previousGame !== nextGame) {
      const fresh = emptyRun(tabId);
      if (gameIdentity(run.gameFrameUrl) === nextGame) {
        Object.assign(fresh, {
          ready: run.ready,
          sdkInitialized: run.sdkInitialized,
          gameFrameUrl: run.gameFrameUrl,
          gameFrameId: run.gameFrameId,
          platformAd: run.platformAd,
          network: run.network,
          frames: run.frames,
          events: run.events,
          warnings: run.warnings,
          gameplayState: run.gameplayState,
          audio: run.audio,
          connection: run.connection
        });
      }
      run = fresh;
      tabRuns.set(tabId, run);
    }
    run.url = message.url || run.url;
    run.title = message.title || run.title;
    if (run.tests?.save?.phase === "reloading") run.tests.save.phase = "waiting-answer";
    const purchases = run.tests?.purchases;
    if (purchases?.phase === "restore-await-reload") {
      purchases.reloadSeen = true;
      purchases.phase = purchases.getPurchasesResolved ? "restore-loaded" : "restore-wait-recovery";
    }
  } else if (message.type === "METRICS") {
    run.frames[message.frameUrl] = message.metrics;
    const frame = run.frames[run.gameFrameUrl];
    run.network = frame ? { ...run.network, ...frame } : { requests: 0, transferBytes: 0, decodedBytes: 0 };
    if (frame) {
      const gameOrigin = (() => { try { return new URL(run.gameFrameUrl).origin; } catch (_) { return null; } })();
      const external = (frame.origins || []).filter((origin) => {
        if (origin === gameOrigin) return false;
        try { return !/(^|\.)yandex\.(ru|com|net)$/.test(new URL(origin).hostname); }
        catch (_) { return false; }
      });
      if (external.length) addWarning(run, "external-origins", "warn", `Внешние источники: ${external.slice(0, 4).join(", ")}`);
      if ((frame.transferBytes || 0) > 25 * 1024 * 1024) addWarning(run, "heavy-transfer", "warn", `Передано больше 25 МБ: ${(frame.transferBytes / 1024 / 1024).toFixed(1)} МБ`);
      if ((frame.decodedBytes || 0) > 100 * 1024 * 1024) addWarning(run, "heavy-decoded", "warn", `Загружено больше 100 МБ ресурсов: ${(frame.decodedBytes / 1024 / 1024).toFixed(1)} МБ`);
      const heaviest = frame.largest?.[0];
      if (heaviest?.bytes > 10 * 1024 * 1024) addWarning(run, "large-resource", "warn", `Тяжёлый ресурс ${(heaviest.bytes / 1024 / 1024).toFixed(1)} МБ: ${heaviest.url}`);
    }
  } else if (message.type === "SDK_EVENT") {
    if (message.eventId) {
      run.recentEventIds ||= [];
      if (run.recentEventIds.includes(message.eventId)) return { ok: true };
      run.recentEventIds.push(message.eventId);
      if (run.recentEventIds.length > 100) run.recentEventIds.splice(0, run.recentEventIds.length - 100);
    }
    if (!run.gameFrameUrl && message.event === "page-error") return { ok: true };
    if (message.event === "sdk-initialized" && (run.sdkInitialized === null || message.isTop === false)) {
      run.sdkInitialized = message.elapsedMs;
      run.gameFrameUrl = message.frameUrl;
      if (Number.isInteger(message.frameId)) run.gameFrameId = message.frameId;
      if (run.frames[message.frameUrl]) run.network = run.frames[message.frameUrl];
    }
    if (run.gameFrameUrl && message.frameUrl !== run.gameFrameUrl) return { ok: true };
    if (message.event === "monitor-ready") {
      run.connection.monitorFrames[message.frameUrl] = { isTop: message.isTop, hasYaGames: message.hasYaGames, at: Date.now() };
    }
    if (message.event === "game-ready" && run.ready === null) {
      run.ready = { elapsedMs: message.elapsedMs, at: Date.now(), frameUrl: message.frameUrl };
      if (message.elapsedMs > 10000) addWarning(run, "slow-ready", "warn", `Game Ready: ${(message.elapsedMs / 1000).toFixed(1)} с`);
    }
    recordEvent(run, message);
    if (message.event === "audio-state") {
      run.audio = { detected: true, active: Boolean(message.active), kind: message.kind || null, state: message.state || (message.active ? "playing" : "silent") };
    } else if (message.event === "webaudio-created" || message.event === "media-play") {
      run.audio.detected = true;
      if (message.event === "media-play") run.audio.active = true;
      run.audio.kind = message.kind || (message.event === "webaudio-created" ? "webaudio" : run.audio.kind);
    }
    if (message.event === "game-ready-timeout") addWarning(run, "ready-timeout", "fail", "Game Ready не вызван за 90 секунд");
    if (message.event === "page-error") addWarning(run, `page-error:${message.message}`, "fail", message.message || "Ошибка JavaScript");
    if (message.event === "rewarded-error") addWarning(run, "rewarded-error", "fail", "Rewarded: SDK onError");
    if (message.event === "interstitial-error") addWarning(run, "interstitial-error", "fail", "Межэкранная реклама: SDK onError");
    if (message.event === "leaderboard-error") addWarning(run, `leaderboard-error:${message.method}`, "fail", `Лидерборд ${message.method}: ${message.error}`);
    if (message.event === "gameplay-start" || message.event === "gameplay-stop") {
      const nextState = message.event === "gameplay-start" ? "started" : "stopped";
      if (run.gameplayState === nextState) addWarning(run, `duplicate-${message.event}`, "fail", `${message.event} вызван дважды подряд`);
      run.gameplayState = nextState;
    }
    for (const test of tests) {
      run.tests[test.id] = await test.event(run.tests[test.id], message, context(tabId));
    }
  } else if (message.type === "CAPTURE") {
    const shot = await capture(tabId, message.label || "Снимок");
    await commit(tabId);
    return { ok: true, shot };
  } else return { ok: false, error: "Unknown message" };
  await commit(tabId, message.type !== "METRICS");
  return { ok: true };
}

function enqueue(tabId, task) {
  const previous = queues.get(tabId) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => { await loaded; return task(); });
  queues.set(tabId, next);
  next.finally(() => { if (queues.get(tabId) === next) queues.delete(tabId); }).catch(() => {});
  return next;
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !isYandexGamesUrl(tab.url)) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["content.js"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["page-monitor.js"], world: "MAIN" });
  } catch (_) {}
});
chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !isYandexGamesUrl(tab.url)) return;
  chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] }).catch(() => {});
  chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["page-monitor.js"], world: "MAIN" }).catch(() => {});
});
chrome.webNavigation?.onCommitted?.addListener((details) => {
  if (!details.tabId || details.frameId === 0 || !isHostedGameFrame(details.url)) return;
  enqueue(details.tabId, async () => {
    const run = getRun(details.tabId);
    run.gameFrameUrl = details.url;
    run.gameFrameId = details.frameId;
    run.connection.contentFrames[details.url] = { isTop: false, at: Date.now(), discoveredBy: "webNavigation" };
    await commit(details.tabId);
    const target = { tabId: details.tabId, frameIds: [details.frameId] };
    await Promise.allSettled([
      chrome.scripting.executeScript({ target, files: ["content.js"] }),
      chrome.scripting.executeScript({ target, files: ["page-monitor.js"], world: "MAIN" })
    ]);
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(tabId, async () => {
    tabRuns.delete(tabId);
    await chrome.storage.local.remove(runKey(tabId));
  }).catch(() => {});
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? message?.tabId;
  if (!tabId || !message?.type || message.type === "STATE") return;
  enqueue(tabId, () => handle(tabId, message))
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});
chrome.runtime.onConnect?.addListener((port) => {
  if (port.name !== "ya-games-qa-content" || !port.sender?.tab?.id) return;
  const tabId = port.sender.tab.id;
  const frameId = port.sender.frameId ?? 0;
  if (!contentPorts.has(tabId)) contentPorts.set(tabId, new Map());
  const framePorts = contentPorts.get(tabId);
  if (!framePorts.has(frameId)) framePorts.set(frameId, new Set());
  framePorts.get(frameId).add(port);
  port.onMessage.addListener((message) => {
    if (!message?.type) return;
    enqueue(tabId, () => handle(tabId, { ...message, frameId })).catch(() => {});
  });
  port.onDisconnect.addListener(() => {
    framePorts.get(frameId)?.delete(port);
    if (!framePorts.get(frameId)?.size) framePorts.delete(frameId);
    if (!framePorts.size) contentPorts.delete(tabId);
  });
  loaded.then(() => commit(tabId, false)).catch(() => {});
});
