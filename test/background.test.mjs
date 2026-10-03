import test from "node:test";
import assert from "node:assert/strict";

test("background restores state and routes test actions", async () => {
  const saved = { "ya-test-run-7": { tabId: 7, network: { requests: 3 }, tests: { save: { phase: "waiting-save", method: "setData" } } } };
  let listener;
  let connectListener;
  let failVisibleCapture = false;
  let failDebuggerCapture = false;
  let failStorage = false;
  let hangStorage = false;
  let hangCapture = false;
  let detachCount = 0;
  const scriptCalls = [];
  const broadcasts = [];
  globalThis.chrome = {
    storage: { local: {
      get: async () => saved,
      set: async (entry) => {
        if (hangStorage) return new Promise(() => {});
        if (failStorage) throw Error("storage failed");
        Object.assign(saved, entry);
      },
      remove: async (key) => { delete saved[key]; }
    } },
    runtime: {
      getManifest: () => ({ version: "1.1.6" }),
      onMessage: { addListener(fn) { listener = fn; } },
      onConnect: { addListener(fn) { connectListener = fn; } },
      sendMessage: async (message) => { broadcasts.push(message); }
    },
    action: { onClicked: { addListener() {} } },
    scripting: { executeScript: async (args) => { scriptCalls.push(args); return []; } },
    debugger: {
      attach: async () => {},
      detach: async () => { detachCount++; },
      sendCommand: async () => {
        if (hangCapture) return new Promise(() => {});
        if (failDebuggerCapture) throw Error("DevTools blocks capture");
        return { data: "FALLBACK" };
      }
    },
    tabs: {
      onRemoved: { addListener() {} },
      get: async () => ({ windowId: 1 }),
      captureVisibleTab: async () => {
        if (hangCapture) return new Promise(() => {});
        if (failVisibleCapture) throw Error("activeTab permission missing");
        return "data:image/png;base64,AAAA";
      },
      reload: async () => {}
    }
  };
  await import(`../background.js?test=${Date.now()}`);
  const overlayMessages = [];
  let portListener;
  connectListener({
    name: "ya-games-qa-content", sender: { tab: { id: 7 }, frameId: 0 },
    onMessage: { addListener(fn) { portListener = fn; } },
    onDisconnect: { addListener() {} },
    postMessage(message) { overlayMessages.push(structuredClone(message)); }
  });
  const send = (message) => new Promise((resolve) => listener({ ...message, tabId: 7 }, {}, resolve));
  failVisibleCapture = true;
  const fallback = await send({ type: "CAPTURE" });
  assert.equal(fallback.shot.dataUrl, "data:image/png;base64,FALLBACK");
  assert.equal(detachCount, 1);
  assert.equal(scriptCalls.length, 2);
  failDebuggerCapture = true;
  const rejected = await send({ type: "CAPTURE" });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /DevTools blocks capture/);
  assert.equal(scriptCalls.length, 4);
  failVisibleCapture = false;
  failDebuggerCapture = false;
  await send({ type: "RESET" });
  await send({ type: "TEST_ACTION", testId: "save", action: "start" });
  let response = await send({ type: "GET_STATE" });
  assert.equal(response.state.tests.save.phase, "waiting-save");
  assert.equal(response.state.tests.rewarded.phase, "idle");
  await send({ type: "CONTENT_READY", frameUrl: "https://app-201572.games.s3.yandex.net/index.html", isTop: false, frameId: 3 });
  response = await send({ type: "GET_STATE" });
  assert.equal(response.state.gameFrameUrl, "https://app-201572.games.s3.yandex.net/index.html");
  assert.equal(response.state.gameFrameId, 3);
  await send({ type: "SDK_EVENT", event: "audio-state", frameUrl: response.state.gameFrameUrl, kind: "webaudio", state: "running", active: true });
  response = await send({ type: "GET_STATE" });
  assert.equal(response.state.audio.active, true);
  await send({ type: "TEST_ACTION", testId: "save", action: "start" });
  await send({ type: "SDK_EVENT", event: "save-resolved", method: "setData", frameUrl: "https://app-201572.games.s3.yandex.net/index.html" });
  response = await send({ type: "GET_STATE" });
  assert.equal(response.state.tests.save.phase, "ready-to-reload");
  assert.equal(response.state.screenshots.length, 0);
  await send({ type: "TEST_ACTION", testId: "save", action: "reload" });
  response = await send({ type: "GET_STATE" });
  assert.equal(response.state.screenshots.length, 1);
  assert.equal(response.state.tests.save.phase, "reloading");
  await send({ type: "PAGE_META", url: "https://yandex.ru/games/app/test-201572", title: "Reloaded" });
  response = await send({ type: "GET_STATE" });
  assert.equal(response.state.tests.save.phase, "waiting-answer");
  failStorage = true;
  failVisibleCapture = true;
  failDebuggerCapture = true;
  await send({ type: "TEST_ACTION", testId: "save", action: "answer", payload: { persisted: true } });
  response = await send({ type: "GET_STATE" });
  assert.equal(response.state.tests.save.phase, "complete");
  assert.equal(response.state.tests.save.result, "good");
  assert.match(response.state.tests.save.error, /второй снимок/);
  assert.ok(response.state.warnings.some((entry) => entry.code === "storage-write"));
  const overlay = overlayMessages.filter((entry) => entry.type === "OVERLAY_STATE").at(-1);
  assert.equal(overlay.views.find((view) => view.id === "save").complete, true);
  assert.ok(overlay.dashboard.hasReport);
  await send({ type: "TEST_ACTION", testId: "save", action: "start" });
  await send({ type: "TEST_ACTION", testId: "save", action: "fail-wait" });
  response = await send({ type: "GET_STATE" });
  assert.equal(response.state.tests.save.phase, "complete");
  assert.equal(response.state.tests.save.result, "fail");
  failStorage = false;
  failVisibleCapture = false;
  failDebuggerCapture = false;
  await send({ type: "SDK_EVENT", event: "sdk-initialized", frameUrl: "https://game.yandex.net/index.html", isTop: false, elapsedMs: 100 });
  await send({ type: "SDK_EVENT", event: "game-ready", frameUrl: "https://game.yandex.net/index.html", isTop: false, elapsedMs: 12000 });
  await send({ type: "SDK_EVENT", event: "gameplay-start", frameUrl: "https://game.yandex.net/index.html", isTop: false, elapsedMs: 13000 });
  await send({ type: "SDK_EVENT", event: "gameplay-start", frameUrl: "https://game.yandex.net/index.html", isTop: false, elapsedMs: 14000 });
  response = await send({ type: "GET_STATE" });
  assert.ok(response.state.events.some((entry) => entry.event === "game-ready"));
  assert.ok(response.state.warnings.some((entry) => entry.code === "slow-ready"));
  assert.ok(response.state.warnings.some((entry) => entry.code === "duplicate-gameplay-start"));
  assert.equal(broadcasts.at(-1).type, "STATE");
  assert.equal((await send({ type: "TEST_ACTION", testId: "missing", action: "start" })).ok, false);
  await send({ type: "RESET" });
  response = await send({ type: "GET_STATE" });
  assert.equal(response.state.tests.save.phase, "idle");
  assert.equal(response.state.screenshots.length, 0);
  await send({ type: "TEST_ACTION", testId: "purchases", action: "start" });
  await send({ type: "TEST_ACTION", testId: "purchases", action: "answer-exists", payload: { answer: true } });
  await send({ type: "SDK_EVENT", event: "purchase-called", productId: "gold" });
  await send({ type: "SDK_EVENT", event: "purchase-error", productId: "gold", error: "PAYMENT_FAILURE" });
  await send({ type: "TEST_ACTION", testId: "purchases", action: "answer", payload: { answer: true } });
  await send({ type: "TEST_ACTION", testId: "purchases", action: "answer", payload: { answer: true } });
  await send({ type: "SDK_EVENT", event: "purchase-called", productId: "gold" });
  await send({ type: "SDK_EVENT", event: "purchase-resolved", productId: "gold" });
  await send({ type: "TEST_ACTION", testId: "purchases", action: "answer", payload: { answer: true } });
  await send({ type: "SDK_EVENT", event: "purchase-called", productId: "gold" });
  response = await send({ type: "GET_STATE" });
  assert.equal(response.state.tests.purchases.phase, "restore-await-reload");
  await send({ type: "PAGE_META", url: "https://yandex.ru/games/app/payment-test-101", title: "Payment reload" });
  response = await send({ type: "GET_STATE" });
  assert.equal(response.state.tests.purchases.phase, "restore-wait-recovery");
  assert.equal(response.state.tests.purchases.reloadSeen, true);
  await send({ type: "RESET" });
  await send({ type: "PAGE_META", url: "https://yandex.ru/games/app/first-game-101", title: "First" });
  await send({ type: "TEST_ACTION", testId: "save", action: "start" });
  await send({ type: "PAGE_META", url: "https://yandex.ru/games/app/translated-title-101?lang=en", title: "Same" });
  response = await send({ type: "GET_STATE" });
  assert.equal(response.state.tests.save.phase, "waiting-save");
  await send({ type: "PAGE_META", url: "https://yandex.ru/games/app/second-game-202", title: "Second" });
  response = await send({ type: "GET_STATE" });
  assert.equal(response.state.tests.save.phase, "idle");
  await send({ type: "TEST_ACTION", testId: "save", action: "start" });
  await send({ type: "CONTENT_READY", frameUrl: "https://app-303.games.s3.yandex.net/303/build/index.html", isTop: false, frameId: 9 });
  await send({ type: "PAGE_META", url: "https://yandex.ru/games/app/third-game-303", title: "Third" });
  response = await send({ type: "GET_STATE" });
  assert.equal(response.state.tests.save.phase, "idle");
  assert.equal(response.state.gameFrameId, 9);
  assert.match(response.state.gameFrameUrl, /app-303/);
  hangStorage = true;
  await send({ type: "TEST_ACTION", testId: "save", action: "start" });
  hangStorage = false;
  response = await send({ type: "GET_STATE" });
  assert.equal(response.state.tests.save.phase, "waiting-save");
  assert.ok(response.state.warnings.some((entry) => entry.code === "storage-write"));
  hangCapture = true;
  const pendingCapture = send({ type: "CAPTURE" });
  const queuedReset = send({ type: "RESET" });
  const timedOut = await pendingCapture;
  assert.equal(timedOut.ok, false);
  assert.match(timedOut.error, /превышено ожидание/);
  hangCapture = false;
  assert.equal((await queuedReset).ok, true);
  response = await send({ type: "GET_STATE" });
  assert.equal(response.state.tests.save.phase, "idle");
  portListener({ type: "TEST_ACTION", testId: "save", action: "start", requestId: 123 });
  await send({ type: "GET_STATE" });
  const acknowledgment = overlayMessages.find((entry) => entry.type === "ACTION_RESULT" && entry.requestId === 123);
  assert.equal(acknowledgment?.ok, true);
  assert.ok(overlayMessages.filter((entry) => entry.type === "OVERLAY_STATE").at(-1).views
    .find((view) => view.id === "save").actions.some((action) => action.action === "fail-wait"));
  delete globalThis.chrome;
});
