const questions = [
  { key: "sameAccount", text: "На устройстве B выполнен вход в тот же Яндекс ID?" },
  { key: "loaded", text: "Игра на устройстве B загрузилась без ошибки?" },
  { key: "sameProgress", text: "На устройстве B появился тот же прогресс, валюта и покупки?" },
  { key: "noDuplicates", text: "После синхронизации награды и покупки не задвоились?" }
];

export const crossDeviceTest = {
  id: "crossDevice",
  title: "СИНХРОНИЗАЦИЯ УСТРОЙСТВ",
  initial: () => ({ phase: "idle", result: null, questionIndex: 0, answers: {}, sourceShot: null, error: null, url: null, qrUrl: null }),

  async action(test, action, payload, context) {
    if (action === "start") {
      const next = { ...this.initial(), phase: "prepare-source", url: context.pageUrl || null };
      if (next.url) {
        try { next.qrUrl = await context.makeQr?.(next.url); }
        catch (error) { next.error = `QR недоступен: ${error}`; }
      }
      return next;
    }
    if (action === "capture-source" && test.phase === "prepare-source") {
      try {
        test.sourceShot = await context.capture("Устройство A — исходный прогресс");
        test.phase = "open-target";
      } catch (error) { test.error = `Не удалось сделать исходный снимок: ${error}`; }
      return test;
    }
    if (action === "opened" && test.phase === "open-target") {
      test.phase = "question";
      test.questionIndex = 0;
      return test;
    }
    if (action === "answer" && test.phase === "question") {
      const question = questions[test.questionIndex];
      if (!question) return test;
      test.answers[question.key] = Boolean(payload?.answer);
      test.questionIndex += 1;
      if (test.questionIndex >= questions.length) {
        test.result = questions.every((item) => test.answers[item.key] === true) ? "good" : "fail";
        test.phase = "complete";
      }
    }
    return test;
  },

  async event(test) { return test; },

  view(test) {
    const yesNo = [
      { label: "ДА", action: "answer", payload: { answer: true }, tone: "yes" },
      { label: "НЕТ", action: "answer", payload: { answer: false }, tone: "no" }
    ];
    const question = questions[test.questionIndex];
    const screens = {
      idle: ["НЕ ЗАПУЩЕНО", "Нажми «Начать».", [{ label: "Начать", action: "start" }]],
      "prepare-source": ["УСТРОЙСТВО A", "Под одним Яндекс ID создай заметный прогресс: пройди уровень или измени валюту. Дождись сохранения и сделай снимок.", [{ label: "Зафиксировать прогресс", action: "capture-source" }]],
      "open-target": ["УСТРОЙСТВО B", "На другом компьютере или телефоне войди в тот же Яндекс ID и открой эту игру по ссылке или QR-коду. Затем нажми «Игра открыта» здесь.", [{ label: "Игра открыта", action: "opened" }]],
      question: ["CHECK", question?.text || "Проверка завершена.", yesNo],
      complete: [test.result === "good" ? "GOOD" : "FAIL", test.result === "good" ? "Прогресс одинаков на двух устройствах." : "Синхронизация между устройствами не работает.", []]
    };
    const [status, instruction, actions] = screens[test.phase] || screens.idle;
    const mark = (key) => test.answers[key] === true ? "GOOD" : test.answers[key] === false ? "FAIL" : "WAIT";
    return {
      status, instruction, actions,
      tone: test.result === "good" ? "good" : test.result === "fail" ? "bad" : "neutral",
      mobileUrl: test.phase === "open-target" ? test.url : null,
      qrUrl: test.phase === "open-target" ? test.qrUrl : null,
      report: test.phase === "idle" ? null : [
        `Один Яндекс ID: ${mark("sameAccount")}`,
        `Запуск на устройстве B: ${mark("loaded")}`,
        `Одинаковый прогресс: ${mark("sameProgress")}`,
        `Нет задвоения наград: ${mark("noDuplicates")}`,
        ...(test.error ? [`Ошибка: ${test.error}`] : [])
      ],
      evidence: [{ label: "Устройство A — исходный прогресс", shot: test.sourceShot }]
    };
  }
};
