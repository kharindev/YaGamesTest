export const moderationTest = {
  id: "moderation",
  title: "АВТОЧЕК МОДЕРАЦИИ",
  initial: () => ({ phase: "idle", result: null, checks: [], error: null }),
  async action(test, action, payload, context) {
    if (action !== "start") return test;
    test = this.initial();
    test.phase = "scanning";
    try {
      test.checks = await context.auditModeration();
      test.result = test.checks.some((item) => item.status === "fail") ? "fail" : "good";
    } catch (error) {
      test.result = "fail";
      test.error = String(error);
    }
    test.phase = "complete";
    return test;
  },
  async event(test) { return test; },
  view(test) {
    const screens = {
      idle: ["НЕ ЗАПУЩЕНО", "Автоматически проверим SDK, Game Ready, HTTPS, ошибки, внешние ссылки, заглушки и переполнение интерфейса.", [{ label: "Запустить автопроверку", action: "start" }]],
      scanning: ["SCAN", "Проверяем игру…", []],
      complete: [test.result?.toUpperCase() || "FAIL", test.result === "good" ? "Автоматические проверки пройдены." : "Найдены нарушения или недоступные обязательные функции.", []]
    };
    const [status, instruction, actions] = screens[test.phase] || screens.idle;
    return {
      status, instruction, actions,
      tone: test.result === "good" ? "good" : test.result === "fail" ? "bad" : "neutral",
      report: test.phase === "idle" ? null : [
        ...test.checks.map((item) => `${item.status.toUpperCase()} — ${item.label}: ${item.detail}`),
        ...(test.error ? [`FAIL — ${test.error}`] : [])
      ],
      evidence: []
    };
  }
};
