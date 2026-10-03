import test from "node:test";
import assert from "node:assert/strict";
import { tests, testById } from "../checks/registry.mjs";

test("registry contains independent test definitions", () => {
  assert.deepEqual(tests.map((entry) => entry.id), ["save", "crossDevice", "purchases", "rewarded", "interstitial", "audio", "language", "leaderboard", "textAudit", "resolution", "mobileDevice", "moderation"]);
  for (const entry of tests) {
    assert.equal(testById.get(entry.id), entry);
    assert.equal(typeof entry.initial, "function");
    assert.equal(typeof entry.action, "function");
    assert.equal(typeof entry.event, "function");
    assert.equal(typeof entry.view, "function");
  }
});

test("cross-device flow fails on any inconsistent result", async () => {
  const definition = testById.get("crossDevice");
  const context = {
    pageUrl: "https://yandex.ru/games/app/example-1",
    makeQr: async () => "data:image/png;base64,QR",
    capture: async (label) => ({ label })
  };
  let state = await definition.action(definition.initial(), "start", {}, context);
  assert.equal(state.phase, "prepare-source");
  state = await definition.action(state, "capture-source", {}, context);
  assert.equal(state.phase, "open-target");
  assert.equal(definition.view(state).qrUrl, "data:image/png;base64,QR");
  state = await definition.action(state, "opened", {}, context);
  for (const answer of [true, true, false, true]) state = await definition.action(state, "answer", { answer }, context);
  assert.equal(state.phase, "complete");
  assert.equal(state.result, "fail");
});

test("mobile device flow evaluates answers by question meaning", async () => {
  const definition = testById.get("mobileDevice");
  let state = await definition.action(definition.initial(), "start", {}, { pageUrl: "https://yandex.ru/games/app/example-1" });
  assert.equal(state.phase, "scan");
  assert.match(definition.view(state).qrUrl, /create-qr-code/);
  state = await definition.action(state, "opened", {}, {});
  for (const answer of [true, true, true, false]) state = await definition.action(state, "answer", { answer }, {});
  assert.equal(state.result, "good");
  assert.equal(definition.view(state).report.length, 4);
  state = await definition.action(definition.initial(), "start", {}, { pageUrl: "https://yandex.ru/games/app/example-1" });
  state = await definition.action(state, "opened", {}, {});
  for (const answer of [true, true, true, true]) state = await definition.action(state, "answer", { answer }, {});
  assert.equal(state.result, "fail");
});

test("save flow and SDK failure", async () => {
  const definition = testById.get("save");
  const shots = [];
  let reloaded = false;
  const context = { capture: async (label) => { shots.push(label); return { label }; }, reload: async () => { reloaded = true; } };
  let state = await definition.action(definition.initial(), "start", {}, context);
  await definition.event(state, { event: "save-called", method: "setData" }, context);
  assert.equal(state.phase, "saving");
  await definition.event(state, { event: "save-resolved", method: "setData" }, context);
  assert.equal(state.phase, "ready-to-reload");
  assert.equal(shots.length, 0);
  assert.match(definition.view(state).instruction, /Откройте на экране/);
  assert.match(definition.view(state).report[2], /успешно/);
  await definition.action(state, "reload", {}, context);
  assert.equal(reloaded, true);
  assert.equal(shots.length, 1);
  await definition.event(state, { event: "sdk-initialized" }, context);
  assert.equal(state.phase, "waiting-answer");
  await definition.action(state, "answer", { persisted: true }, context);
  assert.equal(state.result, "good");
  assert.equal(state.phase, "complete");
  assert.equal(shots.length, 2);
  assert.match(definition.view(state).report[0], /setData/);
  assert.equal(definition.view(state).evidence.length, 2);

  state = await definition.action(state, "start", {}, context);
  await definition.event(state, { event: "save-error", method: "setStats", error: "failed" }, context);
  assert.equal(state.result, "fail");
});

test("save waits for the before screenshot when capture fails", async () => {
  const definition = testById.get("save");
  let reloaded = false;
  const context = { capture: async () => { throw Error("capture failed"); }, reload: async () => { reloaded = true; } };
  const state = await definition.action(definition.initial(), "start", {}, context);
  await definition.event(state, { event: "save-resolved", method: "setData" }, context);
  await definition.action(state, "reload", {}, context);
  assert.equal(state.phase, "ready-to-reload");
  assert.equal(reloaded, false);
  assert.match(definition.view(state).report.at(-1), /capture failed/);
});

test("save finishes even when the after screenshot fails", async () => {
  const definition = testById.get("save");
  const state = { ...definition.initial(), phase: "waiting-answer", method: "setData", sdkResult: "success" };
  await definition.action(state, "answer", { persisted: true }, { capture: async () => { throw Error("capture failed"); } });
  assert.equal(state.phase, "complete");
  assert.equal(state.result, "good");
  assert.match(definition.view(state).report.at(-1), /capture failed/);
});

test("purchases cover cancellation, success, and interrupted-payment recovery", async () => {
  const definition = testById.get("purchases");
  const shots = [];
  const context = { capture: async (label) => { shots.push(label); return { label }; }, persist: async () => {} };
  let state = await definition.action(definition.initial(), "start", {}, context);
  state = await definition.action(state, "answer-exists", { answer: true }, context);
  await definition.event(state, { event: "purchase-called", productId: "gold" }, context);
  await definition.event(state, { event: "purchase-error", productId: "gold", error: "PAYMENT_FAILURE" }, context);
  assert.equal(state.phase, "cancel-ask-game");
  state = await definition.action(state, "answer", { answer: true }, context);
  state = await definition.action(state, "answer", { answer: true }, context);
  assert.equal(state.phase, "normal-wait-call");
  await definition.event(state, { event: "purchase-called", productId: "gold" }, context);
  await definition.event(state, { event: "purchase-resolved", productId: "gold" }, context);
  assert.equal(shots.length, 2);
  state = await definition.action(state, "answer", { answer: true }, context);
  await definition.event(state, { event: "purchase-called", productId: "gold" }, context);
  assert.equal(state.phase, "restore-await-reload");
  state.reloadSeen = true;
  state.phase = "restore-wait-recovery";
  await definition.event(state, { event: "get-purchases-called" }, context);
  await definition.event(state, { event: "get-purchases-resolved", count: 1 }, context);
  await definition.event(state, { event: "consume-purchase-called", productId: "gold" }, context);
  await definition.event(state, { event: "consume-purchase-resolved", productId: "gold" }, context);
  assert.equal(state.phase, "restore-loaded");
  state = await definition.action(state, "check-recovery", {}, context);
  state = await definition.action(state, "answer", { answer: true }, context);
  assert.equal(state.phase, "complete");
  assert.equal(state.result, "good");
  assert.equal(shots.length, 4);
  assert.match(definition.view(state).report.join("\n"), /getPurchases\(\).*GOOD/);
});

test("rewarded skip, success, and capture failure", async () => {
  const definition = testById.get("rewarded");
  const context = { capture: async (label) => ({ label }) };
  let state = await definition.action(definition.initial(), "start", {}, context);
  await definition.action(state, "answer", { answer: false }, context);
  assert.equal(state.result, "skip");
  state = await definition.action(state, "start", {}, context);
  await definition.action(state, "answer", { answer: true }, context);
  for (const event of ["rewarded-called", "rewarded-open"]) await definition.event(state, { event }, context);
  assert.equal(state.phase, "ask-muted");
  await definition.action(state, "answer", { answer: true }, context);
  await definition.action(state, "answer", { answer: true }, context);
  for (const event of ["rewarded-rewarded", "rewarded-close"]) await definition.event(state, { event }, context);
  for (let index = 0; index < 3; index++) await definition.action(state, "answer", { answer: true }, context);
  assert.equal(state.result, "good");
  assert.equal(state.phase, "complete");

  state = await definition.action(state, "start", {}, context);
  await definition.action(state, "answer", { answer: true }, context);
  await definition.event(state, { event: "rewarded-open" }, { capture: async () => { throw Error("capture failed"); } });
  assert.equal(state.phase, "ask-muted");
  assert.match(state.error, /capture failed/);
});

test("interstitial skip and success", async () => {
  const definition = testById.get("interstitial");
  const context = { capture: async (label) => ({ label }) };
  let state = await definition.action(definition.initial(), "start", {}, context);
  state = await definition.action(state, "answer", { answer: true }, context);
  await definition.event(state, { event: "interstitial-called" }, context);
  await definition.event(state, { event: "interstitial-open" }, context);
  await definition.action(state, "answer", { answer: true }, context);
  await definition.action(state, "answer", { answer: true }, context);
  await definition.event(state, { event: "interstitial-close", wasShown: true }, context);
  await definition.action(state, "answer", { answer: true }, context);
  await definition.action(state, "answer", { answer: true }, context);
  assert.equal(state.phase, "complete");
  assert.equal(state.result, "good");
  assert.ok(state.openShot);
  assert.ok(state.finalShot);

  let skipped = await definition.action(definition.initial(), "start", {}, context);
  skipped = await definition.action(skipped, "answer", { answer: false }, context);
  assert.equal(skipped.result, "skip");
});

test("ad flows survive close before mute and pause answers", async () => {
  const context = { capture: async () => ({}), persist: async () => {} };
  const rewarded = testById.get("rewarded");
  let rewardState = await rewarded.action(rewarded.initial(), "start", {}, context);
  rewardState = await rewarded.action(rewardState, "answer", { answer: true }, context);
  await rewarded.event(rewardState, { event: "rewarded-open" }, context);
  await rewarded.event(rewardState, { event: "rewarded-rewarded" }, context);
  await rewarded.event(rewardState, { event: "rewarded-close", wasShown: true }, context);
  assert.equal(rewardState.phase, "ask-muted");
  await rewarded.action(rewardState, "answer", { answer: true }, context);
  await rewarded.action(rewardState, "answer", { answer: true }, context);
  assert.equal(rewardState.phase, "ask-reward");

  const interstitial = testById.get("interstitial");
  let interstitialState = await interstitial.action(interstitial.initial(), "start", {}, context);
  interstitialState = await interstitial.action(interstitialState, "answer", { answer: true }, context);
  await interstitial.event(interstitialState, { event: "interstitial-open" }, context);
  await interstitial.event(interstitialState, { event: "interstitial-close", wasShown: true }, context);
  assert.equal(interstitialState.phase, "ask-muted");
  await interstitial.action(interstitialState, "answer", { answer: true }, context);
  await interstitial.action(interstitialState, "answer", { answer: true }, context);
  assert.equal(interstitialState.phase, "ask-resumed");
});

test("rewarded cannot pass without reward callback", async () => {
  const definition = testById.get("rewarded");
  const context = { capture: async () => ({}), persist: async () => {} };
  let state = await definition.action(definition.initial(), "start", {}, context);
  state = await definition.action(state, "answer", { answer: true }, context);
  await definition.event(state, { event: "rewarded-open" }, context);
  await definition.action(state, "answer", { answer: true }, context);
  await definition.action(state, "answer", { answer: true }, context);
  await definition.event(state, { event: "rewarded-close", wasShown: true }, context);
  for (let index = 0; index < 3; index++) await definition.action(state, "answer", { answer: true }, context);
  assert.equal(state.result, "fail");
});

test("audio counts media signals and fails on system player", async () => {
  const definition = testById.get("audio");
  const gameFrame = "https://yandex.ru/games/1/index.html";
  const context = { gameFrameUrl: gameFrame, capture: async () => ({}) };
  let state = await definition.action(definition.initial(), "start", {}, context);
  assert.equal(state.phase, "ask-has-audio");
  await definition.event(state, { event: "media-play", kind: "audio", frameUrl: gameFrame }, context);
  await definition.event(state, { event: "media-play", kind: "video", frameUrl: gameFrame }, context);
  await definition.event(state, { event: "webaudio-created", frameUrl: gameFrame }, context);
  await definition.event(state, { event: "webaudio-created", frameUrl: "https://yandex.ru/other.html" }, context);
  await definition.event(state, { event: "visibility-hidden", frameUrl: gameFrame }, context);
  assert.equal(state.mediaAudioPlays, 1);
  assert.equal(state.mediaVideoPlays, 1);
  assert.equal(state.webAudioContexts, 1);
  assert.equal(state.focusLost, true);

  state = await definition.action(state, "answer", { answer: true }, context);
  state = await definition.action(state, "next", {}, context);
  assert.equal(state.phase, "ask-system-player");
  state = await definition.action(state, "answer", { answer: true }, context);
  state = await definition.action(state, "next", {}, context);
  state = await definition.action(state, "answer", { answer: true }, context);
  state = await definition.action(state, "answer", { answer: true }, context);
  assert.equal(state.result, "fail");
  assert.equal(state.phase, "complete");

  state = await definition.action(state, "start", {}, context);
  assert.equal(state.phase, "ask-has-audio");
  state = await definition.action(state, "answer", { answer: false }, context);
  assert.equal(state.result, "skip");
  assert.equal(definition.view(state).tone, "warn");
});

test("audio skips focus tracking when hidden outside the game frame", async () => {
  const definition = testById.get("audio");
  const context = { gameFrameUrl: "https://yandex.ru/games/1/index.html" };
  const state = await definition.action(definition.initial(), "start", {}, context);
  await definition.event(state, { event: "visibility-hidden", frameUrl: "https://yandex.ru/other.html" }, context);
  assert.equal(state.focusLost, false);
  await definition.event(state, { event: "visibility-hidden", frameUrl: context.gameFrameUrl }, context);
  assert.equal(state.focusLost, true);
});

test("language reads SDK i18n and captures evidence", async () => {
  const definition = testById.get("language");
  const gameFrame = "https://yandex.ru/games/1/index.html";
  const shots = [];
  const localeChanges = [];
  const context = {
    gameFrameUrl: gameFrame,
    setLanguage: async (lang, locale) => localeChanges.push({ lang, locale }),
    capture: async (label) => { shots.push(label); return { label }; }
  };
  let state = await definition.action(definition.initial(), "start", {}, context);
  assert.equal(state.phase, "select-language");
  state = await definition.action(state, "set-language", { value: "ru" }, context);
  assert.equal(state.phase, "reloading");
  assert.deepEqual(localeChanges[0], { lang: "ru", locale: "ru-RU" });
  await definition.event(state, { event: "sdk-language", lang: "ru", browserLang: "ru-RU", frameUrl: gameFrame }, context);
  assert.equal(state.phase, "ask-visible");
  assert.match(definition.view(state).instruction, /RU/i);
  await definition.event(state, { event: "sdk-language", lang: "ru", browserLang: "ru-RU", frameUrl: "https://yandex.ru/other.html" }, context);
  assert.equal(state.sdkLang, "ru");
  state = await definition.action(state, "answer", { answer: true }, context);
  assert.equal(state.result, "good");
  assert.equal(state.phase, "language-result");
  assert.equal(shots.length, 1);
  assert.match(definition.view(state).report[1], /SDK: ru/);
  assert.match(definition.view(state).evidence[0].shot.label, /Язык ru/);

  state = await definition.action(state, "another", {}, context);
  state = await definition.action(state, "set-language", { value: "en" }, context);
  await definition.event(state, { event: "sdk-language", lang: "en", browserLang: "en-US", frameUrl: gameFrame }, context);
  state = await definition.action(state, "answer", { answer: false }, { ...context, capture: async () => { throw Error("capture failed"); } });
  assert.equal(state.result, "fail");
  assert.equal(state.checks.length, 2);
  assert.match(definition.view(state).report.at(-1), /capture failed/);
  state = await definition.action(state, "finish", {}, context);
  assert.equal(state.phase, "complete");
});

test("language mismatch is immediately a reported failure", async () => {
  const definition = testById.get("language");
  const gameFrame = "https://app-1.games.s3.yandex.net/index.html";
  let state = await definition.action(definition.initial(), "start", {}, {});
  state = await definition.action(state, "set-language", { value: "en" }, { setLanguage: async () => {} });
  await definition.event(state, { event: "sdk-language", lang: "ru", browserLang: "en-US", frameUrl: gameFrame }, { gameFrameUrl: gameFrame });
  assert.equal(state.phase, "language-result");
  assert.equal(state.result, "fail");
  assert.match(state.error, /SDK вернул ru/);
  state = await definition.action(state, "another", {}, {});
  assert.equal(state.result, null);
});

test("text audit cannot pass when scanning failed", async () => {
  const definition = testById.get("textAudit");
  let state = await definition.action(definition.initial(), "start", {}, { scanText: async () => { throw Error("iframe unavailable"); } });
  assert.equal(state.phase, "review");
  state = await definition.action(state, "answer", { answer: true }, { capture: async () => ({}) });
  assert.equal(state.result, "fail");
});
