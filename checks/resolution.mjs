const presets = [
  { id: "desktop", label: "Desktop 1920×1080", width: 1920, height: 1080, mobile: false },
  { id: "laptop", label: "Laptop 1366×768", width: 1366, height: 768, mobile: false },
  { id: "tablet", label: "Tablet 768×1024", width: 768, height: 1024, mobile: true },
  { id: "mobile", label: "Mobile 390×844", width: 390, height: 844, mobile: true }
];

export const resolutionTest = {
  id: "resolution",
  title: "РАЗРЕШЕНИЯ ЭКРАНА",
  initial: () => ({ phase: "idle", result: null, index: 0, checks: [], error: null }),
  async action(test, action, payload, context) {
    if (action === "start") {
      test = this.initial();
      test.phase = "applying";
      try { await context.setViewport(presets[0]); test.phase = "ask-visible"; }
      catch (error) { test.error = String(error); test.result = "fail"; test.phase = "complete"; }
      return test;
    }
    if (action === "answer" && test.phase === "ask-visible") {
      const preset = presets[test.index];
      test.checks.push({ ...preset, good: Boolean(payload?.answer) });
      test.index++;
      if (test.index >= presets.length) {
        test.result = test.checks.every((item) => item.good) ? "good" : "fail";
        test.phase = "complete";
        await context.resetViewport();
      } else {
        test.phase = "applying";
        try { await context.setViewport(presets[test.index]); test.phase = "ask-visible"; }
        catch (error) { test.error = String(error); test.result = "fail"; test.phase = "complete"; await context.resetViewport(); }
      }
    }
    return test;
  },
  async event(test) { return test; },
  view(test) {
    const preset = presets[test.index];
    const screens = {
      idle: ["НЕ ЗАПУЩЕНО", "Проверим desktop, laptop, tablet и mobile в реальных размерах viewport.", [{ label: "Запустить набор", action: "start" }]],
      applying: ["RESIZE", `Устанавливаем ${preset?.label || "размер"}…`, []],
      "ask-visible": ["QUESTION", `${preset.label}: интерфейс помещается, текст читается, управление доступно?`, [{ label: "ДА", action: "answer", payload: { answer: true }, tone: "yes" }, { label: "НЕТ", action: "answer", payload: { answer: false }, tone: "no" }]],
      complete: [test.result?.toUpperCase() || "FAIL", test.result === "good" ? "Все четыре разрешения пройдены." : "На одном или нескольких разрешениях есть проблема.", []]
    };
    const [status, instruction, actions] = screens[test.phase] || screens.idle;
    return { status, instruction, actions, tone: test.result === "good" ? "good" : test.result === "fail" ? "bad" : "neutral",
      report: test.phase === "idle" ? null : [...test.checks.map((item) => `${item.good ? "GOOD" : "FAIL"} — ${item.label}`), ...(test.error ? [`FAIL — ${test.error}`] : [])],
      evidence: [] };
  }
};
