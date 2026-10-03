(() => {
  const pagePath = location.pathname || new URL(location.href).pathname;
  if (window === window.top && !/^\/games\/app\//.test(pagePath)) return;
  if (window.__YA_GAMES_LOAD_AUDITOR__) return;
  window.__YA_GAMES_LOAD_AUDITOR__ = true;

  const started = performance.timeOrigin;
  const elapsed = () => Math.round(Date.now() - started);
  let eventSequence = 0;
  const emit = (event, extra = {}) => {
    const message = {
      source: "YA_GAMES_LOAD_AUDITOR",
      eventId: `${performance.timeOrigin}-${++eventSequence}`,
      event,
      elapsedMs: elapsed(),
      frameUrl: location.href,
      isTop: window === window.top,
      ...extra
    };
    window.postMessage(message, "*");
    if (window !== window.top) window.parent.postMessage(message, "*");
  };
  const call = (method, extra = {}) => emit("sdk-call", { method, ...extra });
  emit("monitor-ready", { hasYaGames: Boolean(window.YaGames) });

  window.addEventListener("error", (event) => emit("page-error", {
    message: event.message || "JavaScript error",
    file: event.filename || "",
    line: event.lineno || 0
  }));
  window.addEventListener("unhandledrejection", (event) => emit("page-error", {
    message: `Unhandled rejection: ${String(event.reason || "unknown")}`
  }));

  const storagePrototype = window.Storage?.prototype;
  if (storagePrototype && typeof storagePrototype.setItem === "function" && !storagePrototype.__yaAuditorSetItem) {
    storagePrototype.__yaAuditorSetItem = true;
    const originalSetItem = storagePrototype.setItem;
    storagePrototype.setItem = function (...args) {
      let area = "webStorage";
      try {
        if (this === window.localStorage) area = "localStorage";
        else if (this === window.sessionStorage) area = "sessionStorage";
      } catch (_) {}
      const method = `${area}.setItem`;
      call(method);
      emit("save-called", { method, storage: area });
      try {
        const result = originalSetItem.apply(this, args);
        emit("save-resolved", { method, storage: area });
        return result;
      } catch (error) {
        emit("save-error", { method, storage: area, error: String(error) });
        throw error;
      }
    };
  }

  const objectStorePrototype = window.IDBObjectStore?.prototype;
  if (objectStorePrototype && !objectStorePrototype.__yaAuditorWrites) {
    objectStorePrototype.__yaAuditorWrites = true;
    for (const operation of ["add", "put", "delete", "clear"]) {
      if (typeof objectStorePrototype[operation] !== "function") continue;
      const original = objectStorePrototype[operation];
      objectStorePrototype[operation] = function (...args) {
        const method = `indexedDB.${operation}`;
        call(method);
        emit("save-called", { method, storage: "indexedDB", store: String(this?.name || "") });
        try {
          const request = original.apply(this, args);
          if (request?.addEventListener) {
            request.addEventListener("success", () => emit("save-resolved", { method, storage: "indexedDB", store: String(this?.name || "") }), { once: true });
            request.addEventListener("error", () => emit("save-error", { method, storage: "indexedDB", store: String(this?.name || ""), error: String(request.error || "IndexedDB error") }), { once: true });
          } else emit("save-resolved", { method, storage: "indexedDB", store: String(this?.name || "") });
          return request;
        } catch (error) {
          emit("save-error", { method, storage: "indexedDB", store: String(this?.name || ""), error: String(error) });
          throw error;
        }
      };
    }
  }

  const reportHidden = () => { if (document.visibilityState === "hidden") emit("visibility-hidden"); };
  document.addEventListener("visibilitychange", reportHidden);
  window.addEventListener("pagehide", reportHidden);

  for (const key of ["AudioContext", "webkitAudioContext"]) {
    const Original = window[key];
    if (typeof Original !== "function") continue;
    const Wrapped = function (...args) {
      emit("webaudio-created");
      const context = Reflect.construct(Original, args, new.target || Original);
      const reportAudioState = () => emit("audio-state", {
        kind: "webaudio",
        state: context.state || "unknown",
        active: context.state === "running"
      });
      context.addEventListener?.("statechange", reportAudioState);
      reportAudioState();
      return context;
    };
    Wrapped.prototype = Original.prototype;
    window[key] = Wrapped;
  }

  const mediaPrototype = window.HTMLMediaElement?.prototype;
  if (mediaPrototype && typeof mediaPrototype.play === "function" && !mediaPrototype.__yaAuditorMediaPlay) {
    mediaPrototype.__yaAuditorMediaPlay = true;
    const originalPlay = mediaPrototype.play;
    mediaPrototype.play = function (...args) {
      emit("media-play", { kind: this?.tagName === "VIDEO" ? "video" : "audio" });
      emit("audio-state", { kind: this?.tagName === "VIDEO" ? "video" : "audio", state: "playing", active: !this?.muted && Number(this?.volume ?? 1) > 0 });
      const result = originalPlay.apply(this, args);
      const reportStopped = () => emit("audio-state", { kind: this?.tagName === "VIDEO" ? "video" : "audio", state: "paused", active: false });
      this?.addEventListener?.("pause", reportStopped, { once: true });
      this?.addEventListener?.("ended", reportStopped, { once: true });
      return result;
    };
  }

  const wrappedSdks = new WeakSet();
  const wrappedPlayers = new WeakSet();
  const wrappedLeaderboards = new WeakSet();
  const wrappedPayments = new WeakSet();
  const purchaseProducts = new Map();
  const wrapPayments = (payments) => {
    if (!payments || wrappedPayments.has(payments)) return payments;
    wrappedPayments.add(payments);
    if (typeof payments.purchase === "function") {
      const original = payments.purchase.bind(payments);
      payments.purchase = (...args) => {
        const productId = typeof args[0]?.id === "string" ? args[0].id : "";
        call("ysdk.payments.purchase", { productId });
        emit("purchase-called", { productId });
        try {
          const result = original(...args);
          return result && typeof result.then === "function" ? result.then((purchase) => {
            const resolvedId = purchase?.productID || productId;
            if (purchase?.purchaseToken) purchaseProducts.set(purchase.purchaseToken, resolvedId);
            emit("purchase-resolved", { productId: resolvedId });
            return purchase;
          }).catch((error) => {
            emit("purchase-error", { productId, error: String(error) });
            throw error;
          }) : result;
        } catch (error) {
          emit("purchase-error", { productId, error: String(error) });
          throw error;
        }
      };
    }
    if (typeof payments.getPurchases === "function") {
      const original = payments.getPurchases.bind(payments);
      payments.getPurchases = (...args) => {
        call("ysdk.payments.getPurchases");
        emit("get-purchases-called");
        try {
          const result = original(...args);
          return result && typeof result.then === "function" ? result.then((purchases) => {
            const list = Array.isArray(purchases) ? purchases : [];
            for (const purchase of list) if (purchase?.purchaseToken) purchaseProducts.set(purchase.purchaseToken, purchase.productID || "");
            emit("get-purchases-resolved", { count: Array.isArray(purchases) ? purchases.length : undefined, signed: Boolean(purchases?.signature) });
            return purchases;
          }).catch((error) => {
            emit("payments-error", { method: "getPurchases", error: String(error) });
            throw error;
          }) : result;
        } catch (error) {
          emit("payments-error", { method: "getPurchases", error: String(error) });
          throw error;
        }
      };
    }
    if (typeof payments.consumePurchase === "function") {
      const original = payments.consumePurchase.bind(payments);
      payments.consumePurchase = (...args) => {
        const productId = purchaseProducts.get(args[0]) || "";
        call("ysdk.payments.consumePurchase", { productId });
        emit("consume-purchase-called", { productId });
        try {
          const result = original(...args);
          return result && typeof result.then === "function" ? result.then((value) => {
            emit("consume-purchase-resolved", { productId });
            purchaseProducts.delete(args[0]);
            return value;
          }).catch((error) => {
            emit("payments-error", { method: "consumePurchase", productId, error: String(error) });
            throw error;
          }) : result;
        } catch (error) {
          emit("payments-error", { method: "consumePurchase", productId, error: String(error) });
          throw error;
        }
      };
    }
    return payments;
  };
  const wrapLeaderboards = (leaderboards) => {
    if (!leaderboards || wrappedLeaderboards.has(leaderboards)) return leaderboards;
    wrappedLeaderboards.add(leaderboards);
    const methods = [["getDescription", "getDescription"], ["setScore", "setScore"], ["getPlayerEntry", "getPlayerEntry"], ["getEntries", "getEntries"]];
    for (const [method, normalized] of methods) {
      if (typeof leaderboards[method] !== "function") continue;
      const original = leaderboards[method].bind(leaderboards);
      leaderboards[method] = (...args) => {
        const extra = { method: normalized, leaderboard: typeof args[0] === "string" ? args[0] : "" };
        call(`ysdk.leaderboards.${normalized}`, extra);
        emit("leaderboard-called", extra);
        try {
          const result = original(...args);
          if (result && typeof result.then === "function") return result.then((value) => {
            emit("leaderboard-resolved", { ...extra, entries: Array.isArray(value?.entries) ? value.entries.length : undefined });
            return value;
          }).catch((error) => {
            emit("leaderboard-error", { ...extra, error: String(error) });
            throw error;
          });
          emit("leaderboard-resolved", extra);
          return result;
        } catch (error) {
          emit("leaderboard-error", { ...extra, error: String(error) });
          throw error;
        }
      };
    }
    return leaderboards;
  };
  const wrapPlayer = (player) => {
    if (!player || wrappedPlayers.has(player)) return player;
    wrappedPlayers.add(player);
    for (const method of ["setData", "setStats"]) {
      if (typeof player[method] !== "function") continue;
      const original = player[method].bind(player);
      player[method] = (...args) => {
        call(`player.${method}`);
        emit("save-called", { method });
        try {
          const result = original(...args);
          if (result && typeof result.then === "function") {
            return result.then((value) => {
              emit("save-resolved", { method });
              return value;
            }).catch((error) => {
              emit("save-error", { method, error: String(error) });
              throw error;
            });
          }
          emit("save-resolved", { method });
          return result;
        } catch (error) {
          emit("save-error", { method, error: String(error) });
          throw error;
        }
      };
    }
    return player;
  };

  const wrapSdk = (sdk) => {
    if (!sdk || wrappedSdks.has(sdk)) return sdk;
    wrappedSdks.add(sdk);
    emit("sdk-initialized");
    wrapLeaderboards(sdk.leaderboards);
    wrapPayments(sdk.payments);
    const adv = sdk.adv;
    if (adv && typeof adv.showRewardedVideo === "function" && !adv.__yaAuditorRewarded) {
      adv.__yaAuditorRewarded = true;
      const originalRewarded = adv.showRewardedVideo.bind(adv);
      adv.showRewardedVideo = (options = {}) => {
        call("ysdk.adv.showRewardedVideo");
        emit("rewarded-called");
        const wrapped = { ...options };
        const hasNestedCallbacks = Boolean(options.callbacks && typeof options.callbacks === "object");
        const sourceCallbacks = hasNestedCallbacks ? options.callbacks : options;
        const callbacks = { ...sourceCallbacks };
        const wrapCallback = (name, event) => {
          const original = sourceCallbacks?.[name];
          callbacks[name] = (...args) => {
            call(`ysdk.adv.showRewardedVideo.${name}`);
            const extra = name === "onClose" ? { wasShown: args[0] }
              : name === "onError" ? { error: String(args[0] || "SDK onError") } : {};
            emit(event, extra);
            return original?.(...args);
          };
        };
        wrapCallback("onOpen", "rewarded-open");
        wrapCallback("onRewarded", "rewarded-rewarded");
        wrapCallback("onClose", "rewarded-close");
        wrapCallback("onError", "rewarded-error");
        wrapped.callbacks = callbacks;
        if (!hasNestedCallbacks) Object.assign(wrapped, callbacks);
        return originalRewarded(wrapped);
      };
    }
    if (adv && typeof adv.showFullscreenAdv === "function" && !adv.__yaAuditorInterstitial) {
      adv.__yaAuditorInterstitial = true;
      const originalInterstitial = adv.showFullscreenAdv.bind(adv);
      adv.showFullscreenAdv = (options = {}) => {
        call("ysdk.adv.showFullscreenAdv");
        emit("interstitial-called");
        const wrapped = { ...options };
        const hasNestedCallbacks = Boolean(options.callbacks && typeof options.callbacks === "object");
        const sourceCallbacks = hasNestedCallbacks ? options.callbacks : options;
        const callbacks = { ...sourceCallbacks };
        const wrapCallback = (name, event) => {
          const original = sourceCallbacks?.[name];
          callbacks[name] = (...args) => {
            call(`ysdk.adv.showFullscreenAdv.${name}`);
            const extra = name === "onClose" ? { wasShown: args[0] }
              : name === "onError" ? { error: String(args[0] || "SDK onError") } : {};
            emit(event, extra);
            return original?.(...args);
          };
        };
        wrapCallback("onOpen", "interstitial-open");
        wrapCallback("onClose", "interstitial-close");
        wrapCallback("onError", "interstitial-error");
        wrapped.callbacks = callbacks;
        if (!hasNestedCallbacks) Object.assign(wrapped, callbacks);
        return originalInterstitial(wrapped);
      };
    }
    if (typeof sdk.getPlayer === "function") {
      const originalGetPlayer = sdk.getPlayer.bind(sdk);
      sdk.getPlayer = (...args) => {
        call("ysdk.getPlayer");
        const result = originalGetPlayer(...args);
        return result && typeof result.then === "function"
          ? result.then(wrapPlayer)
          : wrapPlayer(result);
      };
    }
    if (typeof sdk.getPayments === "function") {
      const originalGetPayments = sdk.getPayments.bind(sdk);
      sdk.getPayments = (...args) => {
        call("ysdk.getPayments");
        const result = originalGetPayments(...args);
        return result && typeof result.then === "function" ? result.then(wrapPayments) : wrapPayments(result);
      };
    }
    const loading = sdk.features?.LoadingAPI;
    if (loading && typeof loading.ready === "function") {
      const originalReady = loading.ready.bind(loading);
      let reported = false;
      setTimeout(() => { if (!reported) emit("game-ready-timeout"); }, 90000);
      loading.ready = (...args) => {
        call("ysdk.features.LoadingAPI.ready");
        if (!reported) {
          reported = true;
          emit("game-ready");
        }
        return originalReady(...args);
      };
    }
    const gameplay = sdk.features?.GameplayAPI;
    if (gameplay && !gameplay.__yaAuditorGameplay) {
      gameplay.__yaAuditorGameplay = true;
      for (const [method, event] of [["start", "gameplay-start"], ["stop", "gameplay-stop"]]) {
        if (typeof gameplay[method] !== "function") continue;
        const original = gameplay[method].bind(gameplay);
        gameplay[method] = (...args) => {
          call(`ysdk.features.GameplayAPI.${method}`);
          emit(event);
          return original(...args);
        };
      }
    }
    const reportLanguage = () => {
      const lang = sdk.environment?.i18n?.lang;
      if (typeof lang !== "string") return;
      emit("sdk-language", { lang, browserLang: navigator.language });
    };
    reportLanguage();
    return sdk;
  };

  const wrappedGames = new WeakSet();
  const wrapYaGames = (games) => {
    if (!games || wrappedGames.has(games) || typeof games.init !== "function") return;
    wrappedGames.add(games);
    const originalInit = games.init.bind(games);
    games.init = (...args) => {
      call("YaGames.init");
      const result = originalInit(...args);
      return result && typeof result.then === "function"
        ? result.then(wrapSdk)
        : wrapSdk(result);
    };
  };

  let current = window.YaGames;
  if (current) wrapYaGames(current);
  try {
    Object.defineProperty(window, "YaGames", {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (value) => {
        current = value;
        wrapYaGames(value);
      }
    });
  } catch (_) {
    const timer = setInterval(() => {
      if (window.YaGames) {
        wrapYaGames(window.YaGames);
        clearInterval(timer);
      }
    }, 25);
    setTimeout(() => clearInterval(timer), 90000);
  }
})();
