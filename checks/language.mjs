const languages = [
  ["ru", "Русский", "ru-RU"], ["en", "English", "en-US"], ["tr", "Türkçe", "tr-TR"],
  ["zh", "中文", "zh-CN"], ["hi", "हिन्दी", "hi-IN"], ["vi", "Tiếng Việt", "vi-VN"],
  ["ar", "العربية", "ar-SA"], ["az", "Azərbaycanca", "az-AZ"], ["be", "Беларуская", "be-BY"],
  ["bg", "Български", "bg-BG"], ["ca", "Català", "ca-ES"], ["cs", "Čeština", "cs-CZ"],
  ["de", "Deutsch", "de-DE"], ["es", "Español", "es-ES"], ["fa", "فارسی", "fa-IR"],
  ["fr", "Français", "fr-FR"], ["he", "עברית", "he-IL"], ["hu", "Magyar", "hu-HU"],
  ["hy", "Հայերեն", "hy-AM"], ["id", "Bahasa Indonesia", "id-ID"], ["it", "Italiano", "it-IT"],
  ["ja", "日本語", "ja-JP"], ["ka", "ქართული", "ka-GE"], ["kk", "Қазақша", "kk-KZ"],
  ["nl", "Nederlands", "nl-NL"], ["pl", "Polski", "pl-PL"], ["pt", "Português", "pt-PT"],
  ["ro", "Română", "ro-RO"], ["sk", "Slovenčina", "sk-SK"], ["sr", "Српски", "sr-RS"],
  ["th", "ไทย", "th-TH"], ["tk", "Türkmençe", "tk-TM"], ["uk", "Українська", "uk-UA"],
  ["uz", "O‘zbekcha", "uz-UZ"]
];

export const languageTest = {
  id: "language",
  title: "ЯЗЫК И ЛОКАЛИЗАЦИЯ",
  initial: () => ({ phase: "idle", result: null, sdkLang: null, browserLang: null, requestedLang: null, checks: [], error: null }),

  async action(test, action, payload, context) {
    if (action === "start" || action === "another") return { ...test, phase: "select-language", result: null, error: null };
    if (action === "finish" && test.phase === "language-result") return { ...test, phase: "complete" };
    if (action === "set-language" && test.phase === "select-language") {
      const selected = languages.find(([code]) => code === payload?.value);
      if (!selected) return { ...test, error: "Неизвестный язык" };
      test.requestedLang = selected[0];
      test.phase = "reloading";
      test.error = null;
      try { await context.setLanguage(selected[0], selected[2]); }
      catch (error) { test.phase = "select-language"; test.error = `Не удалось сменить язык: ${error}`; }
    } else if (action === "answer" && test.phase === "ask-visible") {
      const translated = Boolean(payload?.answer);
      let shot = null;
      test.checks = [...test.checks.filter((item) => item.lang !== test.requestedLang), { lang: test.requestedLang, sdkLang: test.sdkLang, translated, shot: null }];
      test.result = test.checks.every((item) => item.translated && item.sdkLang === item.lang) ? "good" : "fail";
      test.phase = "language-result";
      await context.persist?.();
      try { shot = await context.capture(`Язык ${test.requestedLang} — ${translated ? "GOOD" : "FAIL"}`); }
      catch (error) { test.error = `Снимок не получен: ${error}`; }
      test.checks = test.checks.map((item) => item.lang === test.requestedLang ? { ...item, shot } : item);
    }
    return test;
  },

  async event(test, message, context) {
    if (message.event !== "sdk-language") return test;
    if (context.gameFrameUrl && message.frameUrl !== context.gameFrameUrl) return test;
    test.sdkLang = typeof message.lang === "string" ? message.lang : null;
    test.browserLang = typeof message.browserLang === "string" ? message.browserLang : null;
    if (test.phase === "reloading") {
      test.phase = test.sdkLang === test.requestedLang ? "ask-visible" : "language-result";
      if (test.phase === "language-result") {
        test.result = "fail";
        test.error = `Запрошен ${test.requestedLang}, но SDK вернул ${test.sdkLang || "пусто"}`;
        test.checks = [...test.checks.filter((item) => item.lang !== test.requestedLang), { lang: test.requestedLang, sdkLang: test.sdkLang, translated: false, shot: null }];
      }
    }
    return test;
  },

  view(test) {
    const requestedName = languages.find(([code]) => code === test.requestedLang)?.[1] || test.requestedLang || "выбранном языке";
    const naturalName = ({ ru: "русском", en: "английском", tr: "турецком", zh: "китайском", hi: "хинди", vi: "вьетнамском" })[test.requestedLang] || requestedName;
    const selectAction = [{ label: "Применить и перезагрузить", action: "set-language", options: languages.map(([code, name]) => ({ value: code, label: `${code.toUpperCase()} — ${name}` })) }];
    const screens = {
      idle: ["НЕ ЗАПУЩЕНО", "Выбери язык. Расширение сменит локаль Chrome и перезагрузит игру.", [{ label: "Начать", action: "start" }]],
      "select-language": ["SELECT", "Выбери реальный язык запуска.", selectAction],
      reloading: ["RELOAD", `Меняем язык на ${test.requestedLang?.toUpperCase()} и ждём SDK.`, []],
      "ask-visible": ["QUESTION", `Выбран ${test.requestedLang?.toUpperCase()}. Игра открылась на ${naturalName}?`, [
        { label: "ДА", action: "answer", payload: { answer: true }, tone: "yes" },
        { label: "НЕТ", action: "answer", payload: { answer: false }, tone: "no" }
      ]],
      "language-result": [test.result?.toUpperCase() || "FAIL", test.result === "good" ? `${test.requestedLang?.toUpperCase()} проверен.` : (test.error || `${test.requestedLang?.toUpperCase()} не прошёл проверку.`), [
        { label: "Проверить ещё язык", action: "another" },
        { label: "Завершить", action: "finish" }
      ]],
      complete: [test.result?.toUpperCase() || "FAIL", "Результат проверки языка записан.", []]
    };
    const [status, instruction, actions] = screens[test.phase] || screens.idle;
    return {
      status, instruction, actions,
      tone: test.result === "good" ? "good" : test.result === "fail" ? "bad" : "neutral",
      report: test.phase === "idle" ? null : [
        `Запрошен: ${test.requestedLang || "—"}`,
        `SDK: ${test.sdkLang || "—"}`,
        `Chrome: ${test.browserLang || "—"}`,
        ...test.checks.map((item) => `${item.lang.toUpperCase()}: SDK ${item.sdkLang === item.lang ? "GOOD" : "FAIL"}; перевод ${item.translated ? "GOOD" : "FAIL"}`),
        ...(test.error ? [test.error] : [])
      ],
      evidence: test.checks.filter((item) => item.shot).map((item) => ({ label: `${item.lang.toUpperCase()} — ${item.translated ? "GOOD" : "FAIL"}`, shot: item.shot }))
    };
  }
};
