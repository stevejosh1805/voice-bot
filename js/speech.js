// Speech in and out using the browser's built-in Web Speech API.
// Recognition works in Chrome and Edge (desktop and Android). Chrome sends the audio to
// Google's speech service, so it needs an internet connection. Firefox has no recognition,
// so the text box is the fallback there.
import { forSpeech } from './util.js';

const ERRORS = {
  'not-allowed': 'Microphone access is blocked. Allow the microphone from the lock icon in the address bar, then try again.',
  'service-not-allowed': 'This browser blocks speech recognition. Use Chrome or Edge, or type your message.',
  'no-speech': "I didn't hear anything. Tap the mic and speak after the tone.",
  'audio-capture': 'No microphone was found. Check that one is plugged in and selected.',
  network: 'Speech recognition needs an internet connection in this browser.',
  'language-not-supported': 'That speech language is not supported here. Pick another one in Settings.',
};

export class Voice {
  constructor({ lang = 'en-IN', onInterim, onFinal, onState, onError }) {
    this.lang = lang;
    this.voiceName = '';
    this.rate = 1;
    this.listening = false;
    this.cb = { onInterim, onFinal, onState, onError };

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.canListen = Boolean(SR);
    this.canSpeak = 'speechSynthesis' in window;

    if (SR) {
      const r = new SR();
      r.lang = lang;
      r.interimResults = true;
      r.continuous = false;
      r.maxAlternatives = 1;

      r.onstart = () => { this.listening = true; onState?.('listening'); };
      r.onend = () => { this.listening = false; onState?.('idle'); };
      r.onerror = (e) => {
        if (e.error === 'aborted') return;
        onError?.(ERRORS[e.error] || `Speech recognition stopped (${e.error}).`);
      };
      r.onresult = (e) => {
        let interim = '';
        let final = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) final += res[0].transcript;
          else interim += res[0].transcript;
        }
        if (interim) onInterim?.(interim);
        if (final.trim()) onFinal?.(final.trim());
      };
      this.rec = r;
    }
  }

  setLang(lang) {
    this.lang = lang;
    if (this.rec) this.rec.lang = lang;
  }

  start() {
    if (!this.rec || this.listening) return;
    if (this.canSpeak) speechSynthesis.cancel(); // stop talking when the user wants to talk
    try { this.rec.start(); } catch { /* already starting */ }
  }

  stop() { this.rec?.stop(); }

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
