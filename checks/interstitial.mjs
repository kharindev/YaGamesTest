export const interstitialTest = {
  id: "interstitial",
  title: "МЕЖЭКРАННАЯ РЕКЛАМА",
  initial: () => ({ phase: "idle", result: null, answers: {}, closed: false, wasShown: null, error: null, openShot: null, finalShot: null }),

  async action(state, action, payload, context) {
    if (action === "start") return { ...this.initial(), phase: "ask-exists" };
    if (action !== "answer") return state;
    const answer = Boolean(payload?.answer);
    state.answers ||= {};
    if (state.phase === "ask-exists") {
      state.answers.exists = answer;
      if (!answer) { state.result = "skip"; state.phase = "complete"; }
      else state.phase = "waiting-call";
    } else if (state.phase === "ask-muted") { state.answers.muted = answer; state.phase = "ask-paused"; }
    else if (state.phase === "ask-paused") { state.answers.paused = answer; state.phase = state.closed ? "ask-resumed" : "waiting-close"; }
    else if (state.phase === "ask-resumed") { state.answers.resumed = answer; state.phase = "ask-sound-returned"; }
    else if (state.phase === "ask-sound-returned") {
      state.answers.soundReturned = answer;
      state.result = [state.answers.muted, state.answers.paused, state.answers.resumed, state.answers.soundReturned].every(Boolean)
        && state.wasShown !== false && !state.error ? "good" : "fail";
      state.phase = "complete";
      await context.persist?.();
      try { state.finalShot = await context.capture(`Межэкранная реклама — ${state.result.toUpperCase()}`); }
      catch (error) { state.error = String(error); state.result = "fail"; }
    }
    return state;
  },

  async event(state, message, context) {
    if (message.event === "interstitial-called" && state.phase === "waiting-call") state.phase = "waiting-open";
    if (message.event === "interstitial-open" && ["waiting-call", "waiting-open"].includes(state.phase)) {
      state.phase = "capturing-open";
      await context.persist?.();
      try { state.openShot = await context.capture("Межэкранная реклама — открытие"); }
      catch (error) { state.error = String(error); }
      state.phase = "ask-muted";
    }
    if (message.event === "interstitial-close" && !["idle", "complete", "ask-exists"].includes(state.phase)) {
      state.closed = true;
      state.wasShown = message.wasShown;
      if (message.wasShown === false) {
        state.error = "Реклама не была показана";
        state.result = "fail";
        state.phase = "complete";
      } else if (state.phase === "waiting-close") state.phase = "ask-resumed";
    }
    if (message.event === "interstitial-error" && !["idle", "complete"].includes(state.phase)) {
      state.error = message.error || "SDK onError";
      state.result = "fail";
      state.phase = "complete";
    }
    return state;
  },

  view(state) {
    const yesNo = [
      { label: "ДА", action: "answer", payload: { answer: true }, tone: "yes" },
      { label: "НЕТ", action: "answer", payload: { answer: false }, tone: "no" }
    ];
    const screens = {
      idle: ["НЕ ЗАПУЩЕНО", "Нажми «Начать».", [{ label: "Начать", action: "start" }]],
      "ask-exists": ["QUESTION", "В игре есть межэкранная реклама?", yesNo],
      "waiting-call": ["WAIT", "Вызови межэкранную рекламу.", []],
      "waiting-open": ["WAIT", "Ждём onOpen.", []],
      "capturing-open": ["SCREENSHOT", "Реклама открыта.", []],
      "ask-muted": ["QUESTION", "Звук игры остановился?", yesNo],
      "ask-paused": ["QUESTION", "Игра поставлена на паузу?", yesNo],
      "waiting-close": ["WAIT", "Закрой рекламу.", []],
      "ask-resumed": ["QUESTION", "Игра продолжилась?", yesNo],
      "ask-sound-returned": ["QUESTION", "Звук вернулся?", yesNo],
      "capturing-final": ["SCREENSHOT", "Формируем отчёт.", []],
      complete: [state.result?.toUpperCase() || "FAIL", state.result === "skip" ? "Межэкранная реклама отсутствует." : state.result === "good" ? "Проверка пройдена." : "Есть ошибки.", []]
    };
    const [status, instruction, actions] = screens[state.phase] || screens.idle;
    const mark = (value) => value ? "GOOD" : "FAIL";
    return {
      status, instruction, actions,
      tone: state.result === "good" ? "good" : state.result === "fail" ? "bad" : state.result === "skip" ? "warn" : "neutral",
      report: state.phase !== "complete" ? null : state.result === "skip" ? ["SKIP"] : [
        `Показ: ${state.wasShown === true ? "YES" : "NO"}`, `Mute: ${mark(state.answers?.muted)}`,
        `Pause: ${mark(state.answers?.paused)}`, `Resume: ${mark(state.answers?.resumed)}`,
        `Sound return: ${mark(state.answers?.soundReturned)}`,
        `Screenshots: ${Number(Boolean(state.openShot)) + Number(Boolean(state.finalShot))}`,
        ...(state.error ? [`Ошибка: ${state.error}`] : [])
      ],
      evidence: [{ label: "Реклама открыта", shot: state.openShot }, { label: "После закрытия", shot: state.finalShot }]
    };
  }
};
