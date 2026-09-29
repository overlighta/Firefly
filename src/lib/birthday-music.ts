export type BirthdayMusicState = "idle" | "loading" | "playing" | "paused" | "blocked" | "error";

// A new preview takes over the previous preview's fading tail instead of stacking players.
let stopPrevious: (() => void) | undefined;
const TRACK = "/audio/growing-up-scott-buckley-v1.mp3";

export function createBirthdayMusic(onState: (state: BirthdayMusicState) => void) {
  let audio: HTMLAudioElement | undefined;
  let context: AudioContext | undefined;
  let gain: GainNode | undefined;
  let source: MediaElementAudioSourceNode | undefined;
  let disposed = false;
  let playing = false;
  let pending = false;
  let level = 0;
  let attempt = 0;
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  let disposeTimer: ReturnType<typeof setTimeout> | undefined;

  function state(value: BirthdayMusicState) { if (!disposed) onState(value); }
  function clearTimers() { clearTimeout(pauseTimer); clearTimeout(loadTimer); }
  function fade(value: number, seconds: number) {
    if (!context || !gain || context.state === "closed") return;
    const now = context.currentTime;
    const param = gain.gain;
    // Hold the instantaneous volume when reversing a fade (mute/unmute/close).
    if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(now);
    else { const current = param.value; param.cancelScheduledValues(now); param.setValueAtTime(current, now); }
    param.linearRampToValueAtTime(value, now + seconds);
  }
  function release() {
    clearTimers(); clearTimeout(disposeTimer);
    audio?.pause();
    if (audio) { audio.removeEventListener("error", failed); audio.removeAttribute("src"); audio.load(); }
    source?.disconnect(); gain?.disconnect();
    if (context && context.state !== "closed") void context.close().catch(() => {});
    if (stopPrevious === release) stopPrevious = undefined;
  }
  function failed() {
    if (disposed) return;
    attempt++; clearTimers(); playing = false; pending = false;
    fade(0, 0); audio?.pause(); state("error");
  }
  function ensurePlayer() {
    if (audio) return;
    stopPrevious?.();
    const AudioContextClass = window.AudioContext || (window as typeof window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
    if (!AudioContextClass) throw new Error("Audio unavailable");
    context = new AudioContextClass();
    audio = new Audio();
    audio.preload = "none";
    audio.loop = true;
    gain = context.createGain();
    gain.gain.value = 0;
    gain.gain.setValueAtTime(0, context.currentTime);
    source = context.createMediaElementSource(audio);
    source.connect(gain); gain.connect(context.destination);
    audio.addEventListener("error", failed);
    audio.src = TRACK;
    stopPrevious = release;
  }
  function start() {
    if (disposed) return;
    const currentAttempt = ++attempt;
    clearTimers(); pending = true; state("loading");
    try {
      ensurePlayer();
      if (audio!.error) audio!.load();
      // Both calls occur in the original click handler, before the envelope animation.
      // Gain stays at zero until the candle is on screen; Safari also gets a real gesture.
      const resumed = context!.resume();
      const started = audio!.play();
      const timeout = new Promise<never>((_, reject) => { loadTimer = setTimeout(() => reject(new Error("Audio timeout")), 15_000); });
      void Promise.race([Promise.all([resumed, started]), timeout]).then(() => {
        if (disposed || currentAttempt !== attempt) return;
        clearTimeout(loadTimer); pending = false; playing = true;
        state("playing"); fade(level, 2.8);
      }).catch(error => {
        if (disposed || currentAttempt !== attempt) return;
        clearTimeout(loadTimer); pending = false; playing = false;
        fade(0, 0); audio?.pause();
        state(error?.name === "NotAllowedError" || context?.state === "suspended" ? "blocked" : "error");
      });
    } catch { failed(); }
  }
  function pause(seconds = .65) {
    if (disposed) return;
    attempt++; clearTimers(); pending = false; playing = false;
    state("paused"); fade(0, seconds);
    if (context?.state === "running" && audio && !audio.paused && seconds > 0) pauseTimer = setTimeout(() => audio?.pause(), seconds * 1000);
    else audio?.pause();
  }
  function visibilityChanged() { if (document.hidden) pause(.2); }
  function pageHidden() { pause(0); }
  document.addEventListener("visibilitychange", visibilityChanged);
  window.addEventListener("pagehide", pageHidden);

  return {
    start,
    setScene(scene: "wish" | "letter") {
      level = scene === "wish" ? .32 : .19;
      if (playing) fade(level, scene === "wish" ? 2.8 : 2.2);
    },
    toggle() { if (playing || pending) pause(); else start(); },
    dispose() {
      if (disposed) return;
      disposed = true; attempt++; clearTimers();
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pagehide", pageHidden);
      if (context?.state === "running" && audio && !audio.paused) {
        fade(0, .85);
        disposeTimer = setTimeout(release, 900);
      } else release();
    },
  };
}
