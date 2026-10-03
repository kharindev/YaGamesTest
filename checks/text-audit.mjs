export const textAuditTest = {
  id: "textAudit",
  title: "ТЕКСТ И ИНТЕРФЕЙС",
  initial: () => ({ phase: "idle", result: null, scan: null, readable: null, error: null, shot: null }),
  async action(test, action, payload, context) {
    if (action === "start") {
      test = this.initial();
      test.phase = "scanning";
      try { test.scan = await context.scanText(); test.phase = "review"; }
      catch (error) { test.error = String(error); test.phase = "review"; }
    } else if (action === "answer" && test.phase === "review") {
      test.readable = Boolean(payload?.answer);
      const automaticFail = Boolean(test.error || test.scan?.suspicious?.length || test.scan?.overflowCount);
      test.result = test.readable && !automaticFail ? "good" : "fail";
      test.phase = "complete";
      await context.persist?.();
      try { test.shot = await context.capture(`Текст — ${test.result.toUpperCase()}`); } catch (_) {}
    }
    return test;
  },
  async event(test) { return test; },
  view(test) {
    const canvasOnly = test.scan && test.scan.count === 0;
    const screens = {
      idle: ["НЕ ЗАПУЩЕНО", "Ищем видимый HTML-текст, заглушки и обрезанные элементы.", [{ label: "Сканировать", action: "start" }]],
      scanning: ["SCAN", "Сканируем интерфейс…", []],
      review: [test.scan?.suspicious?.length || test.scan?.overflowCount ? "WARN" : "SCAN GOOD", canvasOnly ? "Текст нарисован в canvas/WebGL — автоматический парсинг недоступен. Визуально текст читаемый и не обрезан?" : `Найдено текстовых элементов: ${test.scan?.count || 0}. Визуально всё читаемо и переведено?`, [{ label: "ДА", action: "answer", payload: { answer: true }, tone: "yes" }, { label: "НЕТ", action: "answer", payload: { answer: false }, tone: "no" }]],
      complete: [test.result?.toUpperCase() || "FAIL", test.result === "good" ? "Текст выглядит корректно." : "Есть проблемы с текстом.", []]
    };
    const [status, instruction, actions] = screens[test.phase] || screens.idle;
    return { status, instruction, actions, tone: test.result === "good" ? "good" : test.result === "fail" ? "bad" : "neutral",
      report: test.phase === "idle" ? null : [`HTML-текстов: ${test.scan?.count ?? "—"}`, `Переполнений: ${test.scan?.overflowCount ?? "—"}`, ...(test.scan?.suspicious || []).map((item) => `Подозрительный текст: ${item}`), ...(test.scan?.samples?.length ? [`Примеры: ${test.scan.samples.join(" | ")}`] : []), ...(test.error ? [test.error] : [])],
      evidence: [{ label: "Текст и интерфейс", shot: test.shot }] };
  }
};
