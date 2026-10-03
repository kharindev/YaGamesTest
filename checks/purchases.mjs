const yesNo = [
  { label: "ДА", action: "answer", payload: { answer: true }, tone: "yes" },
  { label: "НЕТ", action: "answer", payload: { answer: false }, tone: "no" }
];

export const purchasesTest = {
  id: "purchases",
  title: "ПОКУПКИ И ВОССТАНОВЛЕНИЕ",
  initial: () => ({
    phase: "idle", result: null, productId: null, error: null,
    cancelRejected: false, cancelGameWorks: null, cancelNoReward: null,
    normalResolved: false, normalReward: null,
    reloadSeen: false, getPurchasesCalled: false, getPurchasesResolved: false,
    restoredCount: null, consumeCalled: false, consumeResolved: false,
    restoredReward: null, beforeShot: null, afterShot: null, restoreBeforeShot: null, restoreAfterShot: null
  }),

  async action(test, action, payload, context) {
    if (action === "start") return { ...this.initial(), phase: "ask-exists" };
    if (action === "answer-exists" && test.phase === "ask-exists") {
      if (!payload?.answer) return { ...test, phase: "complete", result: "skip" };
      test.phase = "cancel-wait-call";
      return test;
    }
    if (action === "answer" && test.phase === "cancel-ask-game") {
      test.cancelGameWorks = Boolean(payload?.answer);
      test.phase = "cancel-ask-no-reward";
    } else if (action === "answer" && test.phase === "cancel-ask-no-reward") {
      test.cancelNoReward = Boolean(payload?.answer);
      test.phase = "normal-wait-call";
    } else if (action === "answer" && test.phase === "normal-ask-reward") {
      test.normalReward = Boolean(payload?.answer);
      test.phase = "restore-wait-call";
    } else if (action === "check-recovery" && ["restore-loaded", "restore-wait-recovery"].includes(test.phase)) {
      test.phase = "restore-ask-reward";
    } else if (action === "answer" && test.phase === "restore-ask-reward") {
      test.restoredReward = Boolean(payload?.answer);
      test.result = test.cancelRejected && test.cancelGameWorks && test.cancelNoReward
        && test.normalResolved && test.normalReward && test.reloadSeen
        && test.getPurchasesCalled && test.getPurchasesResolved
        && test.consumeCalled && test.consumeResolved && test.restoredReward ? "good" : "fail";
      test.phase = "complete";
      await context.persist?.();
      try { test.restoreAfterShot = await context.capture(test.restoredReward ? "Покупка восстановлена — награда есть" : "Покупка не восстановлена — награды нет"); }
      catch (error) { test.error = `Не удалось сделать итоговый снимок: ${error}`; test.result = "fail"; }
    }
    return test;
  },

  async event(test, message, context) {
    if (message.event === "purchase-called") {
      test.productId = message.productId || test.productId;
      if (test.phase === "cancel-wait-call") test.phase = "cancel-wait-close";
      else if (test.phase === "normal-wait-call") {
        try { test.beforeShot = await context.capture(`До покупки — ${test.productId || "товар"}`); }
        catch (error) { test.error = `Не удалось сделать снимок до покупки: ${error}`; }
        test.phase = "normal-wait-result";
      } else if (test.phase === "restore-wait-call") {
        try { test.restoreBeforeShot = await context.capture(`До аварийного восстановления — ${test.productId || "товар"}`); }
        catch (error) { test.error = `Не удалось сделать снимок перед восстановлением: ${error}`; }
        test.phase = "restore-await-reload";
      }
    }
    if (message.event === "purchase-error") {
      if (["cancel-wait-call", "cancel-wait-close"].includes(test.phase)) {
        test.cancelRejected = true;
        test.phase = "cancel-ask-game";
      } else if (["normal-wait-call", "normal-wait-result"].includes(test.phase)) {
        test.error = `Обычная покупка отклонена: ${message.error || "PAYMENT_FAILURE"}`;
        test.result = "fail";
        test.phase = "complete";
      }
    }
    if (message.event === "purchase-resolved" && ["normal-wait-call", "normal-wait-result"].includes(test.phase)) {
      test.normalResolved = true;
      try { test.afterShot = await context.capture(`После покупки — ${message.productId || test.productId || "товар"}`); }
      catch (error) { test.error = `Не удалось сделать снимок после покупки: ${error}`; }
      test.phase = "normal-ask-reward";
    }
    if (message.event === "get-purchases-called" && ["restore-await-reload", "restore-loaded", "restore-wait-recovery"].includes(test.phase)) {
      test.getPurchasesCalled = true;
      if (test.reloadSeen) test.phase = "restore-wait-recovery";
    }
    if (message.event === "get-purchases-resolved" && ["restore-await-reload", "restore-loaded", "restore-wait-recovery"].includes(test.phase)) {
      test.getPurchasesResolved = true;
      test.restoredCount = Number.isFinite(message.count) ? message.count : null;
      if (test.reloadSeen) test.phase = "restore-loaded";
    }
    if (message.event === "consume-purchase-called" && !["idle", "complete"].includes(test.phase)) test.consumeCalled = true;
    if (message.event === "consume-purchase-resolved" && !["idle", "complete"].includes(test.phase)) test.consumeResolved = true;
    if (message.event === "payments-error" && !["idle", "complete", "cancel-wait-close"].includes(test.phase)) test.error = message.error || "Ошибка payments SDK";
    return test;
  },

  view(test) {
    const screens = {
      idle: ["НЕ ЗАПУЩЕНО", "Нажми «Начать».", [{ label: "Начать", action: "start" }]],
      "ask-exists": ["QUESTION", "В игре есть покупки?", [
        { label: "ДА", action: "answer-exists", payload: { answer: true }, tone: "yes" },
        { label: "НЕТ", action: "answer-exists", payload: { answer: false }, tone: "no" }
      ]],
      "cancel-wait-call": ["ОТМЕНА", "Начни покупку любого товара.", []],
      "cancel-wait-close": ["ОТМЕНА", "Закрой окно оплаты, ничего не покупая. Ждём отклонение purchase().", []],
      "cancel-ask-game": ["CHECK", "После закрытия оплаты игра продолжает работать?", yesNo],
      "cancel-ask-no-reward": ["CHECK", "Награда НЕ была выдана?", yesNo],
      "normal-wait-call": ["ПОКУПКА", "Сделай обычную покупку. Расширение снимет экран до и после ответа SDK.", []],
      "normal-wait-result": ["WAIT", "Заверши оплату и вернись в игру.", []],
      "normal-ask-reward": ["CHECK", "Купленный товар или награда появились в игре?", yesNo],
      "restore-wait-call": ["ВОССТАНОВЛЕНИЕ", "Начни ещё одну расходуемую покупку.", []],
      "restore-await-reload": ["RELOAD", "Оплати. На экране успеха НЕ нажимай «Продолжить» и не возвращайся в игру — сразу перезагрузи страницу браузера (Ctrl+R).", []],
      "restore-wait-recovery": ["RESTORE", "Игра загружена. Ждём getPurchases() и обработку незавершённой покупки.", [{ label: "Проверить результат", action: "check-recovery" }]],
      "restore-loaded": ["RESTORE", "getPurchases() вызван. Открой место начисления награды.", [{ label: "Проверить результат", action: "check-recovery" }]],
      "restore-ask-reward": ["CHECK", "После перезагрузки покупка восстановлена и награда выдана ровно один раз?", yesNo],
      complete: [test.result === "skip" ? "SKIP" : test.result === "good" ? "GOOD" : "FAIL", test.result === "skip" ? "Покупок нет." : test.result === "good" ? "Покупки и восстановление работают." : "Есть ошибка покупок.", []]
    };
    const [status, instruction, actions] = screens[test.phase] || screens.idle;
    const mark = (value) => value === true ? "GOOD" : value === false ? "FAIL" : "WAIT";
    const report = test.phase === "idle" ? null : test.result === "skip" ? ["SKIP — покупок нет"] : [
      `Товар: ${test.productId || "не определён"}`,
      `Отмена вернула rejected: ${mark(test.cancelRejected)}`,
      `Игра после отмены работает: ${mark(test.cancelGameWorks)}`,
      `Награда после отмены не выдана: ${mark(test.cancelNoReward)}`,
      `Обычная purchase() завершилась: ${mark(test.normalResolved)}`,
      `Обычная награда выдана: ${mark(test.normalReward)}`,
      `Перезагрузка до возврата в игру: ${mark(test.reloadSeen)}`,
      `getPurchases() после запуска: ${mark(test.getPurchasesCalled && test.getPurchasesResolved)}`,
      `Необработанных покупок найдено: ${test.restoredCount ?? "не определено"}`,
      `consumePurchase(): ${test.consumeResolved ? "GOOD" : test.consumeCalled ? "WAIT/ERROR" : "не зафиксирован"}`,
      `Покупка восстановлена один раз: ${mark(test.restoredReward)}`,
      ...(test.error ? [`Ошибка: ${test.error}`] : [])
    ];
    return {
      status, instruction, actions,
      tone: test.result === "good" ? "good" : test.result === "fail" ? "bad" : test.result === "skip" ? "warn" : "neutral",
      report,
      evidence: [
        { label: "До обычной покупки", shot: test.beforeShot },
        { label: "После обычной покупки", shot: test.afterShot },
        { label: "До перезагрузки оплаты", shot: test.restoreBeforeShot },
        { label: "После восстановления", shot: test.restoreAfterShot }
      ]
    };
  }
};
