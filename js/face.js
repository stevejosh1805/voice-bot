// Face detection + recognition in the browser with @vladmandic/face-api (TensorFlow.js).
// Nothing leaves the laptop: models download once from the CDN, faces are stored in localStorage.
import { loadScript, sleep } from './util.js';

const FACEAPI_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.js';
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/';
const STORE_KEY = 'voicebot.faces.v1';
const DETECT_EVERY_MS = 250;

export class FaceGreeter {
  constructor({ video, overlay, threshold = 0.5, onStatus, onFrame }) {
    this.video = video;
    this.overlay = overlay;
    this.threshold = threshold;
    this.onStatus = onStatus || (() => {});
    this.onFrame = onFrame || (() => {});
    this.people = this._load();
    this.ready = false;
    this.running = false;
    this.paused = false;
    this.matcher = null;
    this.colors = {
      known: getComputedStyle(document.documentElement).getPropertyValue('--known').trim() || '#1D7F55',
      unknown: getComputedStyle(document.documentElement).getPropertyValue('--motion').trim() || '#C97A12',
    };
  }

  get fa() { return window.faceapi; }

  async init() {
    if (this.ready) return;
    this.onStatus('busy', 'Loading face models');
    await loadScript(FACEAPI_URL);
    const fa = this.fa;
    if (fa.tf?.ready) await fa.tf.ready();
    await Promise.all([
      fa.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      fa.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      fa.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    this.opts = new fa.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
    this.ready = true;
    this._rebuild();
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser cannot open the camera. Use Chrome or Edge over https or localhost.');
    }
    await this.init();
    this.onStatus('busy', 'Opening camera');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    // Match the frame to the camera's real aspect ratio so the face boxes line up.
    if (this.video.videoWidth && this.video.parentElement) {
      const el = this.video.parentElement;
      el.style.setProperty('--ar', `${this.video.videoWidth} / ${this.video.videoHeight}`);
      el.style.setProperty('--ar-num', String(this.video.videoWidth / this.video.videoHeight));
    }
    this.running = true;
    this.onStatus('on', 'Camera on');
    this._loop();
  }

  stop() {
    this.running = false;
    clearTimeout(this._timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    const ctx = this.overlay.getContext('2d');
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.onStatus('off', 'Camera off');
    this.onFrame([]);
  }

  setThreshold(t) {
    this.threshold = t;
    this._rebuild();
  }

  // ---------- recognition loop ----------
  async _loop() {
    if (!this.running) return;
    if (!this.paused) {
      try {
        const faces = await this._detect();
        this._draw(faces);
        this.onFrame(faces);
      } catch (err) {
        console.warn('Face detection error', err);
      }
    }
    this._timer = setTimeout(() => this._loop(), DETECT_EVERY_MS);
  }

  async _detect() {
    if (!this.ready || this.video.readyState < 2) return [];
    const results = await this.fa
      .detectAllFaces(this.video, this.opts)
      .withFaceLandmarks()
      .withFaceDescriptors();
    return results.map((r) => {
      let name = null;
      let distance = null;
      if (this.matcher) {
        const best = this.matcher.findBestMatch(r.descriptor);
        distance = best.distance;
        if (best.label !== 'unknown') name = best.label;
      }
      return { name, distance, box: r.detection.box, descriptor: r.descriptor };
    });
  }

  _draw(faces) {
    const v = this.video;
    const c = this.overlay;
    const dpr = window.devicePixelRatio || 1;
    const w = v.clientWidth;
    const h = v.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!v.videoWidth) return;

    const s = w / v.videoWidth;
    ctx.font = '600 14px "Atkinson Hyperlegible", system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    for (const f of faces) {
      const b = f.box;
      // The video is mirrored with CSS, so mirror the x coordinate too.
      const x = (v.videoWidth - b.x - b.width) * s;
      const y = b.y * s;
      const bw = b.width * s;
      const bh = b.height * s;
      const color = f.name ? this.colors.known : this.colors.unknown;

      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.strokeRect(x, y, bw, bh);

      const label = f.name || 'Unknown';
      const tw = ctx.measureText(label).width + 12;
      const ly = Math.max(22, y);
      ctx.fillStyle = color;
      ctx.fillRect(x - 1, ly - 22, tw, 22);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + 5, ly - 4);
    }
  }

  // ---------- enrolment ----------
  async enroll(name, { samples = 5, onProgress } = {}) {
    const clean = name.trim();
    if (!clean) throw new Error('Enter a name first.');
    if (!this.running) throw new Error('Start the camera first.');
    this.paused = true;
    const got = [];
    let tries = 0;
    try {
      while (got.length < samples && tries < samples * 8) {
        tries++;
        const res = await this.fa
          .detectAllFaces(this.video, this.opts)
          .withFaceLandmarks()
          .withFaceDescriptors();
        if (res.length === 1) {
          got.push(Array.from(res[0].descriptor, (n) => +n.toFixed(5)));
          onProgress?.(got.length, samples, null);
        } else {
          onProgress?.(got.length, samples, res.length === 0 ? 'none' : 'many');
        }
        await sleep(300);
      }
    } finally {
      this.paused = false;
    }
    if (got.length < samples) {
      throw new Error('Could not get a clear view. Face the camera alone, in good light, and try again.');
    }
    const existing = this.people.find((p) => p.name.toLowerCase() === clean.toLowerCase());
    if (existing) existing.descriptors = existing.descriptors.concat(got).slice(-15);
    else this.people.push({ name: clean, descriptors: got });
    this._save();
    this._rebuild();
    return clean;
  }

  list() { return this.people.map((p) => ({ name: p.name, samples: p.descriptors.length })); }

  remove(name) {
    this.people = this.people.filter((p) => p.name !== name);
    this._save();
    this._rebuild();
  }

  exportJSON() {
    return JSON.stringify({ version: 1, people: this.people });
  }

  importJSON(text) {
    const data = JSON.parse(text);
    if (!Array.isArray(data?.people)) throw new Error('That file is not a saved-faces export.');
    for (const p of data.people) {
      if (typeof p.name !== 'string' || !Array.isArray(p.descriptors)) continue;
      const ok = p.descriptors.filter((d) => Array.isArray(d) && d.length === 128);
      if (!ok.length) continue;
      const existing = this.people.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
      if (existing) existing.descriptors = existing.descriptors.concat(ok).slice(-15);
      else this.people.push({ name: p.name, descriptors: ok });
    }
    this._save();
    this._rebuild();
  }

  // ---------- storage ----------
  _rebuild() {
    if (!this.ready || !this.people.length) { this.matcher = null; return; }
    const fa = this.fa;
    const labeled = this.people.map((p) =>
      new fa.LabeledFaceDescriptors(p.name, p.descriptors.map((d) => new Float32Array(d))));
    this.matcher = new fa.FaceMatcher(labeled, this.threshold);
  }

  _load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return Array.isArray(data.people) ? data.people : [];
    } catch {
      return [];
    }
  }

  _save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, people: this.people }));
    } catch {
      console.warn('Could not save faces to localStorage');
    }
  }
}
