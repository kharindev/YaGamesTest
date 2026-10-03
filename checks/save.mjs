export const saveTest = {
  id: "save",
  title: "СОХРАНЕНИЯ",
  initial: () => ({ phase: "idle", method: null, sdkResult: null, result: null, error: null, beforeShot: null, afterShot: null }),

  async action(test, action, payload, context) {
    if (action === "start") return { ...this.initial(), phase: "waiting-save" };
    if (action === "reload" && test.phase === "ready-to-reload") {
      if (!test.beforeShot) {
        try {
          test.beforeShot = await context.capture(`До перезагрузки — ${test.method || "сохранение"}`);
        } catch (error) {
          test.error = `Не удалось сделать снимок до перезагрузки: ${error}`;
          return test;
        }
      }
      test.error = null;
      test.phase = "reloading";
      try { await context.reload(); }
      catch (error) { test.error = `Не удалось перезагрузить игру: ${error}`; test.phase = "ready-to-reload"; }
    }
    if (action === "answer" && test.phase === "waiting-answer") {
      const persisted = Boolean(payload?.persisted);
      test.result = persisted ? "good" : "fail";
      test.phase = "complete";
      await context.persist?.();
      try {
        test.afterShot = await context.capture(persisted ? "После перезагрузки — данные есть" : "После перезагрузки — данных нет");
        test.error = null;
      } catch (error) { test.error = `Результат записан, но второй снимок не получен: ${error}`; }
    }
    return test;
  },

  async event(test, message, context) {
    if (["sdk-initialized", "game-ready"].includes(message.event) && test.phase === "reloading") test.phase = "waiting-answer";
    if (message.event === "save-called" && test.phase === "waiting-save") {
      test.method = message.method;
      test.phase = "saving";
    }
    if (message.event === "save-resolved" && ["waiting-save", "saving"].includes(test.phase)) {
      test.method = message.method;
      test.sdkResult = "success";
      test.phase = "ready-to-reload";
    }
    if (message.event === "save-error" && ["waiting-save", "saving"].includes(test.phase)) {
      test.method = message.method;
      test.sdkResult = "error";
      test.error = message.error;
      test.result = "fail";
      test.phase = "complete";
    }
    return test;
  },

  view(test) {
    const screens = {
      idle: ["НЕ ЗАПУЩЕНО", "Нажми «Начать».", [{ label: "Начать", action: "start" }]],
      "waiting-save": ["WAIT", "Сделай в игре действие, которое сохраняет прогресс. Отслеживаются SDK, localStorage и IndexedDB.", []],
      saving: ["SAVE", `Вызван ${test.method || "метод сохранения"}. Ждём ответ.`, []],
      "capturing-before": ["SCREENSHOT", "Откройте на экране то, что должно сохраниться.", []],
      "ready-to-reload": ["SAVE OK", `Вызов ${test.method || "сохранения"} прошёл. Откройте на экране то, что должно сохраниться, затем сделайте снимок и перезагрузите игру.`, [{ label: "Снимок и перезагрузка", action: "reload" }]],
      reloading: ["RELOAD", "Ждём загрузку игры после перезагрузки.", []],
      "waiting-answer": ["CHECK", "Снова откройте то, что должно было сохраниться. Данные на месте? Нажмите «ДА» или «НЕТ» — расширение сразу сделает второй снимок.", [{ label: "ДА", action: "answer", payload: { persisted: true }, tone: "yes" }, { label: "НЕТ", action: "answer", payload: { persisted: false }, tone: "no" }]],
      complete: [test.result === "good" ? "GOOD" : "FAIL", test.result === "good" ? "Сохранения работают." : "Сохранения не работают.", []]
    };
    const [status, instruction, actions] = screens[test.phase] || screens.idle;
    const methodCalled = Boolean(test.method);
    const saved = test.sdkResult === "success" || ["ready-to-reload", "reloading", "waiting-answer"].includes(test.phase) || (test.phase === "complete" && test.result === "good");
    const report = [
      `Проверяем: ${test.method ? `${test.method}()` : "SDK или браузерное хранилище"}`,
      `Вызов метода: ${methodCalled ? "зафиксирован" : "ожидаем"}`,
      `Ответ SDK: ${test.sdkResult === "error" ? "ошибка" : saved ? "успешно" : "ожидаем"}`,
      `До перезагрузки: ${test.beforeShot ? "снимок сделан" : "ожидаем снимок"}`,
      `После перезагрузки: ${test.afterShot ? "снимок сделан" : "ожидаем снимок"}`,
      `Результат: ${test.result === "good" ? "данные сохранились" : test.result === "fail" ? "данные не сохранились или произошла ошибка" : "ожидаем проверки"}`,
      ...(test.error ? [`Ошибка: ${test.error}`] : [])
    ];
    return { status, instruction, actions, tone: test.result === "good" ? "good" : test.result === "fail" ? "bad" : saved ? "good" : "neutral",
      report: test.phase === "idle" ? null : report,
      evidence: [
        { label: "До перезагрузки", shot: test.beforeShot },
        { label: "После перезагрузки", shot: test.afterShot }
      ] };
  }
};
