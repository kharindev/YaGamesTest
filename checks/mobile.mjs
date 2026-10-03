const questions = [
  { id: "launch", text: "Игра запустилась на телефоне?", goodAnswer: true },
  { id: "layout", text: "Интерфейс помещается и текст читается?", goodAnswer: true },
  { id: "controls", text: "Управление на телефоне работает?", goodAnswer: true },
  { id: "performance", text: "Игра лагает или зависает?", goodAnswer: false }
];

export const mobileTest = {
  id: "mobileDevice",
  title: "ТЕСТ НА ТЕЛЕФОНЕ",
  initial: () => ({ phase: "idle", result: null, url: null, qrUrl: null, index: 0, checks: [] }),
  async action(test, action, payload, context) {
    if (action === "start") {
      const next = { ...this.initial(), phase: "scan", url: context.pageUrl, qrUrl: null };
      if (next.url) next.qrUrl = context.makeQr ? await context.makeQr(next.url) : `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(next.url)}`;
      return next;
    }
    if (action === "opened" && test.phase === "scan") return { ...test, phase: "question", index: 0 };
    if (action === "answer" && test.phase === "question") {
      const question = questions[test.index];
      const answer = Boolean(payload?.answer);
      test.checks.push({ id: question.id, text: question.text, answer, good: answer === question.goodAnswer });
      test.index++;
      if (test.index >= questions.length) {
        test.result = test.checks.every((item) => item.good) ? "good" : "fail";
        test.phase = "complete";
      }
    }
    return test;
  },
  async event(test) { return test; },
  view(test) {
    const question = questions[test.index];
    const screens = {
      idle: ["НЕ ЗАПУЩЕНО", "Открой игру на реальном телефоне по QR-коду.", [{ label: "Начать", action: "start" }]],
      scan: ["QR", "Отсканируй QR-код телефоном и дождись запуска игры.", [{ label: "Игра открыта", action: "opened" }]],
      question: ["QUESTION", question?.text || "Проверь игру на телефоне.", [
        { label: "ДА", action: "answer", payload: { answer: true }, tone: "yes" },
        { label: "НЕТ", action: "answer", payload: { answer: false }, tone: "no" }
      ]],
      complete: [test.result?.toUpperCase() || "FAIL", test.result === "good" ? "Мобильная версия работает." : "В мобильной версии есть проблемы.", []]
    };
    const [status, instruction, actions] = screens[test.phase] || screens.idle;
    return {
      status, instruction, actions,
      tone: test.result === "good" ? "good" : test.result === "fail" ? "bad" : "neutral",
      mobileUrl: test.phase === "scan" ? test.url : null,
      qrUrl: test.phase === "scan" ? test.qrUrl : null,
      report: test.phase === "idle" ? null : test.checks.map((item) => `${item.good ? "GOOD" : "FAIL"} — ${item.text} Ответ: ${item.answer ? "ДА" : "НЕТ"}`),
      evidence: []
    };
  }
};
