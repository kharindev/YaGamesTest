import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("page monitor observes SDK without dropping original callbacks", async () => {
  const source = await readFile(new URL("../page-monitor.js", import.meta.url), "utf8");
  const events = [];
  const listeners = {};
  const timers = [];
  let rewardedOptions;
  let interstitialOptions;
  let rejectPurchase = false;
  class FakeStorage { setItem() { return undefined; } }
  class FakeObjectStore {
    constructor() { this.name = "save"; }
    put() { return { addEventListener(name, callback) { if (name === "success") callback(); } }; }
  }
  const sdk = {
    adv: {
      showRewardedVideo(options) { rewardedOptions = options; return "rewarded-result"; },
      showFullscreenAdv(options) { interstitialOptions = options; return "interstitial-result"; }
    },
    features: {
      LoadingAPI: { ready() { return "ready-result"; } },
      GameplayAPI: { start() { return "start-result"; }, stop() { return "stop-result"; } }
    },
    environment: { i18n: { lang: "ru" } },
    payments: {
      purchase: async ({ id }) => {
        if (rejectPurchase) throw Error("PAYMENT_FAILURE");
        return { productID: id, purchaseToken: "secret-token" };
      },
      getPurchases: async () => [{ productID: "gold", purchaseToken: "secret-token" }],
      consumePurchase: async () => undefined
    },
    leaderboards: {
      getDescription: async (name) => ({ name }),
      getEntries: async () => ({ entries: [{ rank: 1 }] })
    },
    getPlayer: async () => ({ setData: async () => "saved" })
  };
  const window = {
    top: null,
    YaGames: { init: async () => sdk },
    Storage: FakeStorage,
    localStorage: new FakeStorage(),
    sessionStorage: new FakeStorage(),
    IDBObjectStore: FakeObjectStore,
    addEventListener(name, callback) { listeners[name] = callback; },
    postMessage(message) { events.push(message); }
  };
  window.top = window;
  const context = vm.createContext({
    window,
    document: { visibilityState: "visible", addEventListener() {} },
    location: { href: "https://yandex.ru/games/app/test", pathname: "/games/app/test" },
    navigator: { language: "ru-RU" },
    performance: { timeOrigin: Date.now() - 100 },
    setTimeout(callback) { timers.push(callback); return timers.length; },
    setInterval() { return 1; }, clearInterval() {},
    URL, WeakSet, Object, Reflect, Date, String, Error, Promise
  });
  vm.runInContext(source, context);
  window.localStorage.setItem("level", "2");
  new window.IDBObjectStore().put({ level: 2 });
  assert.ok(events.some((entry) => entry.event === "save-resolved" && entry.method === "localStorage.setItem"));
  assert.ok(events.some((entry) => entry.event === "save-resolved" && entry.method === "indexedDB.put"));
  const wrappedSdk = await window.YaGames.init();
  let rewardedOpened = 0;
  assert.equal(wrappedSdk.adv.showRewardedVideo({ callbacks: { onOpen() { rewardedOpened++; } } }), "rewarded-result");
  rewardedOptions.callbacks.onOpen();
  rewardedOptions.callbacks.onRewarded();
  rewardedOptions.callbacks.onClose(true);
  assert.equal(rewardedOpened, 1);
  assert.ok(events.some((entry) => entry.event === "rewarded-open"));
  assert.ok(events.some((entry) => entry.event === "rewarded-rewarded"));
  assert.ok(events.some((entry) => entry.event === "rewarded-close" && entry.wasShown === true));

  let closed = false;
  assert.equal(wrappedSdk.adv.showFullscreenAdv({ onClose() { closed = true; } }), "interstitial-result");
  interstitialOptions.onOpen();
  interstitialOptions.onClose(true);
  assert.equal(closed, true);
  assert.ok(events.some((entry) => entry.event === "interstitial-open"));
  assert.ok(events.some((entry) => entry.event === "interstitial-close"));

  assert.equal(wrappedSdk.features.LoadingAPI.ready(), "ready-result");
  assert.equal(wrappedSdk.features.GameplayAPI.start(), "start-result");
  assert.equal(wrappedSdk.features.GameplayAPI.stop(), "stop-result");
  assert.ok(events.some((entry) => entry.event === "game-ready"));
  assert.ok(events.some((entry) => entry.event === "gameplay-start"));
  assert.ok(events.some((entry) => entry.event === "gameplay-stop"));

  const player = await wrappedSdk.getPlayer();
  assert.equal(await player.setData({ level: 2 }), "saved");
  assert.ok(events.some((entry) => entry.event === "save-called"));
  assert.ok(events.some((entry) => entry.event === "save-resolved"));

  const purchase = await wrappedSdk.payments.purchase({ id: "gold" });
  assert.equal(purchase.productID, "gold");
  assert.ok(events.some((entry) => entry.event === "purchase-called" && entry.productId === "gold"));
  assert.ok(events.some((entry) => entry.event === "purchase-resolved" && entry.productId === "gold"));
  assert.equal(events.some((entry) => JSON.stringify(entry).includes("secret-token")), false);
  const purchases = await wrappedSdk.payments.getPurchases();
  await wrappedSdk.payments.consumePurchase(purchases[0].purchaseToken);
  assert.ok(events.some((entry) => entry.event === "get-purchases-resolved" && entry.count === 1));
  assert.ok(events.some((entry) => entry.event === "consume-purchase-resolved" && entry.productId === "gold"));
  rejectPurchase = true;
  await assert.rejects(wrappedSdk.payments.purchase({ id: "gold" }));
  assert.ok(events.some((entry) => entry.event === "purchase-error"));

  await wrappedSdk.leaderboards.getDescription("main");
  await wrappedSdk.leaderboards.getEntries("main", { quantityTop: 10 });
  assert.ok(events.some((entry) => entry.event === "leaderboard-called" && entry.method === "getDescription"));
  assert.ok(events.some((entry) => entry.event === "leaderboard-resolved" && entry.method === "getEntries" && entry.entries === 1));
});
