export const rewardedTest = {
  id: "rewarded",
  title: "REWARDED",
  initial: () => ({ phase: "idle", result: null, answers: {}, rewarded: false, closed: false, wasShown: null, error: null, openShot: null, finalShot: null }),

  async action(test, action, payload, context) {
    if (action === "start") return { ...this.initial(), phase: "ask-exists" };
    if (action !== "answer") return test;
    const answer = Boolean(payload?.answer);
    test.answers ||= {};
    if (test.phase === "ask-exists") {
      test.answers.exists = answer;
      if (!answer) { test.result = "skip"; test.phase = "complete"; }
      else test.phase = "waiting-call";
    } else if (test.phase === "ask-muted") { test.answers.muted = answer; test.phase = "ask-paused"; }
    else if (test.phase === "ask-paused") { test.answers.paused = answer; test.phase = test.closed ? "ask-reward" : "waiting-close"; }
    else if (test.phase === "ask-reward") { test.answers.rewardCorrect = answer; test.phase = "ask-resumed"; }
    else if (test.phase === "ask-resumed") { test.answers.resumed = answer; test.phase = "ask-sound-returned"; }
    else if (test.phase === "ask-sound-returned") {
      test.answers.soundReturned = answer;
      const checks = [test.answers.muted, test.answers.paused, test.answers.rewardCorrect, test.answers.resumed, test.answers.soundReturned];
      test.result = checks.every(Boolean) && test.rewarded && test.wasShown !== false && !test.error ? "good" : "fail";
      test.phase = "complete";
      await context.persist?.();
      try { test.finalShot = await context.capture(`Rewarded — ${test.result.toUpperCase()}`); }
      catch (error) { test.error = String(error); test.result = "fail"; }
    }
    return test;
  },

  async event(test, message, context) {
    if (message.event === "rewarded-called" && test.phase === "waiting-call") test.phase = "waiting-open";
    if (message.event === "rewarded-open" && ["waiting-call", "waiting-open"].includes(test.phase)) {
      test.phase = "capturing-open";
      await context.persist?.();
      try { test.openShot = await context.capture("Rewarded — открытие"); }
      catch (error) { test.error = String(error); }
      test.phase = "ask-muted";
    }
    if (message.event === "rewarded-rewarded" && !["idle", "complete"].includes(test.phase)) test.rewarded = true;
    if (message.event === "rewarded-close" && !["idle", "complete", "ask-exists"].includes(test.phase)) {
      test.closed = true;
      test.wasShown = message.wasShown;
      if (message.wasShown === false) {
        test.error = "Реклама не была показана";
        test.result = "fail";
        test.phase = "complete";
      } else if (test.phase === "waiting-close") test.phase = "ask-reward";
    }
    if (message.event === "rewarded-error" && !["idle", "complete"].includes(test.phase)) {
      test.error = "SDK onError";
      test.result = "fail";
      test.phase = "complete";
    }
    return test;
  },

  view(test) {
    const yesNo = [{ label: "ДА", action: "answer", payload: { answer: true }, tone: "yes" }, { label: "НЕТ", action: "answer", payload: { answer: false }, tone: "no" }];
    const screens = {
      idle: ["НЕ ЗАПУЩЕНО", "Нажми «Начать».", [{ label: "Начать", action: "start" }]],
      "ask-exists": ["QUESTION", "В игре есть rewarded?", yesNo],
      "waiting-call": ["WAIT", "Вызови rewarded.", []],
      "waiting-open": ["WAIT", "Ждём onOpen.", []],
      "capturing-open": ["SCREENSHOT", "Реклама открыта.", []],
      "ask-muted": ["QUESTION", "Звук игры остановился?", yesNo],
      "ask-paused": ["QUESTION", "Игра поставлена на паузу?", yesNo],
      "waiting-close": ["WAIT", "Досмотри или закрой рекламу.", []],
      "ask-reward": [test.rewarded ? "QUESTION" : "SDK FAIL", "Награда выдана корректно?", yesNo],
      "ask-resumed": ["QUESTION", "Игра продолжилась?", yesNo],
      "ask-sound-returned": ["QUESTION", "Звук вернулся?", yesNo],
      "capturing-final": ["SCREENSHOT", "Формируем отчёт.", []],
      complete: [test.result?.toUpperCase() || "FAIL", test.result === "skip" ? "Rewarded отсутствует." : test.result === "good" ? "Проверка пройдена." : "Есть ошибки.", []]
    };
    const [status, instruction, actions] = screens[test.phase] || screens.idle;
    const mark = (value) => value ? "GOOD" : "FAIL";
    return { status, instruction, actions, tone: test.result === "good" ? "good" : test.result === "fail" ? "bad" : test.result === "skip" ? "warn" : "neutral",
      report: test.phase !== "complete" ? null : test.result === "skip" ? ["SKIP"] : [
        `Mute: ${mark(test.answers?.muted)}`, `Pause: ${mark(test.answers?.paused)}`,
        `Reward callback: ${test.rewarded ? "YES" : "NO"}`, `Reward result: ${mark(test.answers?.rewardCorrect)}`,
        `Resume: ${mark(test.answers?.resumed)}`, `Sound return: ${mark(test.answers?.soundReturned)}`,
        `Screenshots: ${Number(Boolean(test.openShot)) + Number(Boolean(test.finalShot))}`,
        ...(test.error ? [`Ошибка: ${test.error}`] : [])
      ] };
  }
};
