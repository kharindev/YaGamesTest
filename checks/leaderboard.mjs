export const leaderboardTest = {
  id: "leaderboard",
  title: "ЛИДЕРБОРДЫ",
  initial: () => ({ phase: "idle", result: null, calls: [], errors: [], visible: null, shot: null }),
  async action(test, action, payload, context) {
    if (action === "start") return { ...this.initial(), phase: "ask-has" };
    if (action === "has") {
      if (!payload?.answer) return { ...test, phase: "complete", result: "skip" };
      return { ...test, phase: "waiting-call" };
    }
    if (action === "answer" && test.phase === "ask-visible") {
      test.visible = Boolean(payload?.answer);
      test.result = test.visible && test.calls.some((item) => item.status === "resolved") && !test.errors.length ? "good" : "fail";
      test.phase = "complete";
      await context.persist?.();
      try { test.shot = await context.capture(`Лидерборд — ${test.result.toUpperCase()}`); } catch (_) {}
    }
    return test;
  },
  async event(test, message) {
    if (message.event === "leaderboard-called") {
      test.calls.push({ method: message.method, leaderboard: message.leaderboard, status: "called" });
    }
    if (message.event === "leaderboard-resolved") {
      const item = [...test.calls].reverse().find((call) => call.method === message.method && call.status === "called");
      if (item) Object.assign(item, { status: "resolved", entries: message.entries });
      else test.calls.push({ method: message.method, leaderboard: message.leaderboard, status: "resolved", entries: message.entries });
      if (test.phase === "waiting-call") test.phase = "ask-visible";
    }
    if (message.event === "leaderboard-error") {
      test.errors.push(`${message.method}: ${message.error}`);
      if (test.phase === "waiting-call") test.phase = "ask-visible";
    }
    return test;
  },
  view(test) {
    const screens = {
      idle: ["НЕ ЗАПУЩЕНО", "Проверка реальных вызовов Leaderboards API.", [{ label: "Начать", action: "start" }]],
      "ask-has": ["QUESTION", "В игре есть таблица лидеров?", [{ label: "ДА", action: "has", payload: { answer: true }, tone: "yes" }, { label: "НЕТ", action: "has", payload: { answer: false } }]],
      "waiting-call": ["WAIT", "Открой таблицу лидеров внутри игры.", []],
      "ask-visible": [test.errors.length ? "FAIL" : "SDK GOOD", "Таблица открылась и данные игроков отображаются корректно?", [{ label: "ДА", action: "answer", payload: { answer: true }, tone: "yes" }, { label: "НЕТ", action: "answer", payload: { answer: false }, tone: "no" }]],
      complete: [test.result?.toUpperCase() || "FAIL", test.result === "skip" ? "Лидербордов нет." : test.result === "good" ? "Лидерборд работает." : "Ошибка лидерборда.", []]
    };
    const [status, instruction, actions] = screens[test.phase] || screens.idle;
    return { status, instruction, actions, tone: test.result === "good" ? "good" : test.result === "fail" ? "bad" : "neutral",
      report: test.phase === "idle" ? null : [...test.calls.map((item) => `${item.method} (${item.leaderboard || "без имени"}) — ${item.status.toUpperCase()}${item.entries == null ? "" : `, записей: ${item.entries}`}`), ...test.errors.map((item) => `FAIL — ${item}`)],
      evidence: [{ label: "Таблица лидеров", shot: test.shot }] };
  }
};
