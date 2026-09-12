// Speech in and out using the browser's built-in Web Speech API.
// Recognition works in Chrome and Edge (desktop and Android). Chrome sends the audio to
// Google's speech service, so it needs an internet connection. Firefox has no recognition,
// so the text box is the fallback there.
//
// While listening we also open the mic with getUserMedia to measure the input level.
// That drives the level ring on the mic button and tells us, when nothing is recognised,
// whether the mic was silent (device problem) or heard sound without words.
import { forSpeech } from './util.js';

const SILENCE_TIMEOUT_MS = 10000;

const ERRORS = {
  'not-allowed': 'Microphone access is blocked. Click the lock icon in the address bar, set Microphone to Allow, then reload.',
  'service-not-allowed': 'This browser blocks speech recognition. Use Chrome or Edge, or type your message.',
  'audio-capture': 'No microphone was found. Check that one is connected and enabled in Windows sound settings.',
  network: 'Speech recognition needs an internet connection in this browser.',
  'language-not-supported': 'That speech language is not supported here. Pick another one in Settings.',
};

const NO_SPEECH_SILENT = "The microphone isn't picking up any sound. Check it isn't muted, then open chrome://settings/content/microphone and pick the right microphone.";
const NO_SPEECH_HEARD = 'I heard sound but no words. Start speaking as soon as the mic turns blue, a little closer to the laptop.';

export class Voice {
  constructor({ lang = 'en-IN', onInterim, onFinal, onState, onError, onLevel }) {
    this.lang = lang;
    this.voiceName = '';
    this.rate = 1;
    this.listening = false;
    this.cb = { onInterim, onFinal, onState, onError, onLevel };

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.canListen = Boolean(SR);
    this.canSpeak = 'speechSynthesis' in window;

    if (SR) {
      const r = new SR();
      r.lang = lang;
      r.interimResults = true;
      r.continuous = true;          // don't give up after the first short pause
      r.maxAlternatives = 1;

      r.onstart = () => {
        this.listening = true;
        this.gotWords = false;
        this.peak = 0;
        this._armSilenceTimer();
        onState?.('listening');
      };
      r.onend = () => {
        this.listening = false;
        clearTimeout(this._silence);
        this._stopMeter();
        if (!this.gotWords && !this._handledError && !this._aborted) {
          onError?.(this.peak < 0.04 ? NO_SPEECH_SILENT : NO_SPEECH_HEARD);
        }
        this._handledError = false;
        this._aborted = false;
        onState?.('idle');
      };
      r.onerror = (e) => {
        if (e.error === 'aborted') { this._aborted = true; return; }
        if (e.error === 'no-speech') return; // reported in onend with a better diagnosis
        this._handledError = true;
        onError?.(ERRORS[e.error] || `Speech recognition stopped (${e.error}).`);
      };
      r.onresult = (e) => {
        this._armSilenceTimer();
        let interim = '';
        let final = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) final += res[0].transcript;
          else interim += res[0].transcript;
        }
        if (interim) onInterim?.(interim);
        if (final.trim()) {
          this.gotWords = true;
          r.stop();                 // one utterance per tap
          onFinal?.(final.trim());
        }
      };
      this.rec = r;
    }
  }

  _armSilenceTimer() {
    clearTimeout(this._silence);
    this._silence = setTimeout(() => this.rec?.stop(), SILENCE_TIMEOUT_MS);
  }

  async _startMeter() {
    if (!this.cb.onLevel || !navigator.mediaDevices?.getUserMedia) return;
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!this.listening) { this._stopMeter(); return; }
      this._ctx = new AudioContext();
      const src = this._ctx.createMediaStreamSource(this._stream);
      const an = this._ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        if (!this._ctx) return;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
        this.peak = Math.max(this.peak, level);
        this.cb.onLevel(level);
        this._raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      this.peak = 1; // can't measure; don't blame the mic
    }
  }

  _stopMeter() {
    cancelAnimationFrame(this._raf);
    this._stream?.getTracks().forEach((t) => t.stop());
    this._stream = null;
    this._ctx?.close();
    this._ctx = null;
    this.cb.onLevel?.(0);
  }

  setLang(lang) {
    this.lang = lang;
    if (this.rec) this.rec.lang = lang;
  }

  start() {
    if (!this.rec || this.listening) return;
    if (this.canSpeak) speechSynthesis.cancel(); // stop talking when the user wants to talk
    try {
      this.rec.start();
      this.listening = true;
      this._startMeter();
    } catch { /* already starting */ }
  }

  stop() {
    this._aborted = !this.gotWords; // a manual stop isn't a "didn't hear you"
    this.rec?.stop();
  }

  toggle() { this.listening ? this.stop() : this.start(); }

  voices() {
    return this.canSpeak ? speechSynthesis.getVoices() : [];
  }

  speak(text) {
    const clean = forSpeech(text);
    if (!this.canSpeak || !clean) return;
    if (this.listening) this.rec.abort(); // don't let the mic hear the bot
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = this.lang;
    u.rate = this.rate;
    const v = this.voices().find((x) => x.name === this.voiceName);
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }
}
