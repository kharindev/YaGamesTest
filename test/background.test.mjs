import test from "node:test";
import assert from "node:assert/strict";

test("background restores state and routes test actions", async () => {
  const saved = { "ya-test-run-7": { tabId: 7, network: { requests: 3 }, tests: { save: { phase: "waiting-save", method: "setData" } } } };
  let listener;
  let failVisibleCapture = false;
  let failDebuggerCapture = false;
  let detachCount = 0;
  const scriptCalls = [];
  const broadcasts = [];
  globalThis.chrome = {
    storage: { local: {
      get: async () => saved,
      set: async (entry) => Object.assign(saved, entry),
      remove: async (key) => { delete saved[key]; }
    } },
    runtime: { getManifest: () => ({ version: "0.18.0" }), onMessage: { addListener(fn) { listener = fn; } }, sendMessage: async (message) => { broadcasts.push(message); } },
    action: { onClicked: { addListener() {} } },
    scripting: { executeScript: async (args) => { scriptCalls.push(args); return []; } },
    debugger: {
      attach: async () => {},
      detach: async () => { detachCount++; },
      sendCommand: async () => {
        if (failDebuggerCapture) throw Error("DevTools blocks capture");
        return { data: "FALLBACK" };
      }
    },
    tabs: {
      onRemoved: { addListener() {} },
      get: async () => ({ windowId: 1 }),
      captureVisibleTab: async () => {
        if (failVisibleCapture) throw Error("activeTab permission missing");
        return "data:image/png;base64,AAAA";
      },
      reload: async () => {}
    }
  };
  await import(`../background.js?test=${Date.now()}`);
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
  delete globalThis.chrome;
});
