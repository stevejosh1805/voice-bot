// Top-down robot simulator on a <canvas>. The view follows the robot, the grid scrolls,
// and a trail shows where it has been. One grid square = one step.

const TURN_DEG_PER_S = 180;
const MOVE_STEPS_PER_S = 2;
const CELL = 30; // px per step

const css = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export class RobotSim {
  constructor(canvas, onUpdate) {
    this.canvas = canvas;
    this.onUpdate = onUpdate || (() => {});
    this.colors = {
      bg: css('--panel', '#F6F8F9'),
      grid: css('--line', '#C7CFD6'),
      ink: css('--ink', '#17212B'),
      muted: css('--muted', '#586674'),
      motion: css('--motion', '#C97A12'),
    };
    this.reset();
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  reset() {
    this.x = 0;
    this.y = 0;
    this.heading = 0; // degrees, 0 = up, clockwise positive
    this.trail = [{ x: 0, y: 0 }];
    this.queue = [];
    this.active = null;
    this._emit();
    this.draw();
  }

  enqueue(cmd) {
    if (cmd.action === 'stop') { this.stop(); return; }
    this.queue.push(cmd);
    if (!this.active) this._next();
  }

  stop() {
    this.queue = [];
    if (this.active?.kind === 'move') this.trail.push({ x: this.x, y: this.y });
    this.active = null;
    this._emit();
    this.draw();
  }

  _next() {
    const cmd = this.queue.shift();
    if (!cmd) { this.active = null; this._emit(); return; }
    if (cmd.action === 'rotate') {
      const delta = cmd.dir === 'left' ? -cmd.deg : cmd.deg;
      this.active = { kind: 'rotate', from: this.heading, to: this.heading + delta, t: 0, dur: Math.abs(delta) / TURN_DEG_PER_S };
    } else if (cmd.action === 'move') {
      const sign = cmd.dir === 'backward' ? -1 : 1;
      const rad = (this.heading * Math.PI) / 180;
      const d = sign * cmd.steps;
      this.active = {
        kind: 'move', fx: this.x, fy: this.y,
        tx: this.x + d * Math.sin(rad), ty: this.y - d * Math.cos(rad),
        t: 0, dur: cmd.steps / MOVE_STEPS_PER_S,
      };
    }
    this._emit();
    this._last = performance.now();
    requestAnimationFrame((now) => this._tick(now));
  }

  _tick(now) {
    const a = this.active;
    if (!a) return;
    const dt = (now - this._last) / 1000;
    this._last = now;
    a.t = Math.min(a.dur, a.t + dt);
    const p = a.dur ? a.t / a.dur : 1;
    if (a.kind === 'rotate') this.heading = a.from + (a.to - a.from) * p;
    else { this.x = a.fx + (a.tx - a.fx) * p; this.y = a.fy + (a.ty - a.fy) * p; }
    this.draw();
    this._emit();
    if (p >= 1) {
      if (a.kind === 'move') this.trail.push({ x: this.x, y: this.y });
      this._next();
    } else {
      requestAnimationFrame((n) => this._tick(n));
    }
  }

  _emit() {
    const tidy = (v) => { const r = Math.round(v * 10) / 10; return Object.is(r, -0) ? 0 : r; };
    this.onUpdate({
      x: tidy(this.x),
      y: tidy(-this.y), // show "up" as positive y
      heading: ((Math.round(this.heading) % 360) + 360) % 360,
      busy: Boolean(this.active),
      queued: this.queue.length,
    });
  }

  draw() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
    if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const col = this.colors;
    const cx = w / 2;
    const cy = h / 2;
    const toScreen = (px, py) => [cx + (px - this.x) * CELL, cy + (py - this.y) * CELL];

    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, w, h);

    // grid (scrolls with the robot)
    ctx.strokeStyle = col.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const ox = ((cx - this.x * CELL) % CELL + CELL) % CELL;
    const oy = ((cy - this.y * CELL) % CELL + CELL) % CELL;
    for (let gx = ox; gx < w; gx += CELL) { ctx.moveTo(Math.round(gx) + 0.5, 0); ctx.lineTo(Math.round(gx) + 0.5, h); }
    for (let gy = oy; gy < h; gy += CELL) { ctx.moveTo(0, Math.round(gy) + 0.5); ctx.lineTo(w, Math.round(gy) + 0.5); }
    ctx.stroke();

    // start marker
    const [sx, sy] = toScreen(0, 0);
    ctx.strokeStyle = col.muted;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.moveTo(sx - 10, sy); ctx.lineTo(sx + 10, sy);
    ctx.moveTo(sx, sy - 10); ctx.lineTo(sx, sy + 10);
    ctx.stroke();

    // trail
    ctx.strokeStyle = col.motion;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([2, 7]);
    ctx.beginPath();
    this.trail.forEach((p, i) => { const [px, py] = toScreen(p.x, p.y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    // robot
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((this.heading * Math.PI) / 180);
    ctx.fillStyle = col.ink;
    ctx.fillRect(-15, -9, 5, 18);          // left wheel
    ctx.fillRect(10, -9, 5, 18);           // right wheel
    ctx.beginPath();
    ctx.roundRect(-10, -14, 20, 28, 5);    // body
    ctx.fill();
    ctx.fillStyle = col.motion;
    ctx.beginPath();                        // nose shows which way is forward
    ctx.moveTo(0, -24); ctx.lineTo(7, -13); ctx.lineTo(-7, -13);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // north marker
    ctx.fillStyle = col.muted;
    ctx.font = '600 12px "Chakra Petch", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', w - 18, 20);
    ctx.beginPath();
    ctx.moveTo(w - 18, 26); ctx.lineTo(w - 22, 34); ctx.lineTo(w - 14, 34);
    ctx.closePath();
    ctx.fill();
  }
}
