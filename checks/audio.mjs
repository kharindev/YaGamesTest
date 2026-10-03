export const audioTest = {
  id: "audio",
  title: "ЗВУК И СИСТЕМНЫЙ ПЛЕЕР",
  initial: () => ({
    phase: "idle", result: null, answers: {},
    webAudioContexts: 0, mediaAudioPlays: 0, mediaVideoPlays: 0,
    focusLost: false, error: null
  }),

  async action(test, action, payload) {
    if (action === "start") return {
      ...this.initial(),
      webAudioContexts: test.webAudioContexts || 0,
      mediaAudioPlays: test.mediaAudioPlays || 0,
      mediaVideoPlays: test.mediaVideoPlays || 0,
      phase: "ask-has-audio"
    };
    if (action === "answer" && test.phase === "ask-has-audio") {
      test.answers.hasAudio = Boolean(payload?.answer);
      if (!test.answers.hasAudio) { test.result = "skip"; test.phase = "complete"; }
      else test.phase = "waiting-play";
    } else if (action === "next" && test.phase === "waiting-play") {
      test.phase = "ask-system-player";
    } else if (action === "answer" && test.phase === "ask-system-player") {
      test.answers.systemPlayer = Boolean(payload?.answer);
      test.phase = "waiting-focus";
    } else if (action === "next" && test.phase === "waiting-focus") {
      test.phase = "ask-muted";
    } else if (action === "answer" && test.phase === "ask-muted") {
      test.answers.muted = Boolean(payload?.answer);
      test.phase = "ask-resumed";
    } else if (action === "answer" && test.phase === "ask-resumed") {
      test.answers.resumed = Boolean(payload?.answer);
      test.result = !test.answers.systemPlayer && test.answers.muted && test.answers.resumed ? "good" : "fail";
      test.phase = "complete";
    }
    return test;
  },

  async event(test, message, context) {
    if (context.gameFrameUrl && message.frameUrl !== context.gameFrameUrl) return test;
    if (message.event === "webaudio-created") test.webAudioContexts++;
    if (message.event === "media-play" && message.kind === "audio") test.mediaAudioPlays++;
    if (message.event === "media-play" && message.kind === "video") test.mediaVideoPlays++;
    if (message.event === "visibility-hidden" && !["idle", "complete"].includes(test.phase)) test.focusLost = true;
    return test;
  },

  view(test) {
    const yesNo = [
      { label: "ДА", action: "answer", payload: { answer: true }, tone: "yes" },
      { label: "НЕТ", action: "answer", payload: { answer: false }, tone: "no" }
    ];
    const screens = {
      idle: ["НЕ ЗАПУЩЕНО", "Проверка системного плеера и остановки звука при потере фокуса.", [{ label: "Начать", action: "start" }]],
      "ask-has-audio": ["QUESTION", "В игре есть музыка или звуковые эффекты?", yesNo],
      "waiting-play": ["PLAY", "Запустите в игре музыку или звук. Когда звук слышен, нажмите «Продолжить».", [{ label: "Продолжить", action: "next" }]],
      "ask-system-player": ["QUESTION", "Открылся ли системный плеер браузера из-за звука игры? Проверьте значок управления медиа в браузере или шторку телефона.", yesNo],
      "waiting-focus": ["FOCUS", "Переключитесь на другую вкладку или сверните браузер, затем вернитесь. Проверьте, останавливался ли звук.", [{ label: "Вернулся в игру", action: "next" }]],
      "ask-muted": ["QUESTION", "Звук игры остановился после потери фокуса?", yesNo],
      "ask-resumed": ["QUESTION", "После возврата звук работает корректно?", yesNo],
      complete: [test.result?.toUpperCase() || "FAIL", test.result === "skip" ? "В игре нет звука — проверка пропущена." : test.result === "good" ? "Проверка звука пройдена." : "Есть замечания по звуку.", []]
    };
    const [status, instruction, actions] = screens[test.phase] || screens.idle;
    const answer = (value) => value == null ? "не проверено" : value ? "да" : "нет";
    return {
      status, instruction, actions,
      tone: test.result === "good" ? "good" : test.result === "fail" ? "bad" : test.result === "skip" ? "warn" : "neutral",
      report: test.phase === "idle" ? null : [
        `Web Audio: создано AudioContext — ${test.webAudioContexts || 0}`,
        `HTML <audio>: вызовов play() — ${test.mediaAudioPlays || 0}`,
        `HTML <video>: вызовов play() — ${test.mediaVideoPlays || 0}`,
        "Эти счётчики показывают обнаруженные вызовы, но не доказывают отсутствие системного плеера.",
        `Системный плеер от игры: ${answer(test.answers?.systemPlayer)}`,
        `Потеря фокуса замечена: ${answer(test.focusLost)}`,
        `Звук остановился: ${answer(test.answers?.muted)}`,
        `Звук вернулся: ${answer(test.answers?.resumed)}`,
        ...(test.error ? [`Ошибка: ${test.error}`] : [])
      ]
    };
  }
};
