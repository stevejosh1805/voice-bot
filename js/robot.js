// Sends robot commands out of the browser.
//
//   sim   – nothing leaves the page; the on-screen simulator shows what would happen.
//   mqtt  – publish JSON to <topic>/cmd over MQTT-over-WebSocket. Works from GitHub Pages
//           because the broker is wss:// (secure). Pi / ESP32 subscribe to the same topic.
//   ws    – plain WebSocket straight to the robot (e.g. ESP32 WebSocketsServer on port 81).
//           Browsers block ws:// from an https:// page, so this mode only works when the
//           site is opened from http://localhost or http://<laptop-ip>.
//
// Command format (one JSON object per message):
//   {"id":7,"action":"move","dir":"forward","steps":3,"cm":30,"ts":1757570000000}
//   {"id":8,"action":"rotate","dir":"right","deg":180,"ts":...}
//   {"id":9,"action":"stop","ts":...}
import { loadScript, randomId } from './util.js';

const MQTT_LIB = 'https://cdn.jsdelivr.net/npm/mqtt@5.15.2/dist/mqtt.min.js';

export class RobotLink {
  constructor({ onState, onMessage }) {
    this.onState = onState || (() => {});
    this.onMessage = onMessage || (() => {});
    this.mode = 'sim';
    this.seq = 0;
  }

  async configure(s) {
    this.disconnect();
    this.mode = s.linkMode;
    this.topic = (s.topic || 'voicebot/robot').replace(/\/+$/, '');

    if (this.mode === 'sim') {
      this.onState('sim', 'Simulator only');
      return;
    }

    if (this.mode === 'mqtt') {
      this.onState('busy', 'Connecting to broker');
      try {
        await loadScript(MQTT_LIB);
      } catch (e) {
        this.onState('error', e.message);
        return;
      }
      const client = window.mqtt.connect(s.mqttUrl, {
        clientId: `voicebot-web-${randomId(8)}`,
        reconnectPeriod: 4000,
        connectTimeout: 8000,
        clean: true,
      });
      client.on('connect', () => {
        client.subscribe(`${this.topic}/status`);
        this.onState('on', 'Robot link: MQTT');
      });
      client.on('reconnect', () => this.onState('busy', 'Reconnecting to broker'));
      client.on('offline', () => this.onState('warn', 'Broker offline'));
      client.on('error', (err) => this.onState('error', `Broker error: ${err.message}`));
      client.on('message', (_t, payload) => this.onMessage(payload.toString()));
      this.client = client;
      return;
    }

    if (this.mode === 'ws') {
      if (location.protocol === 'https:' && s.wsUrl.startsWith('ws://')) {
        this.onState('error', 'ws:// is blocked on https pages. Use MQTT, or open the site from localhost.');
        return;
      }
      this._openWs(s.wsUrl);
    }
  }

  _openWs(url) {
    this.onState('busy', 'Connecting to robot');
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.onState('error', `Bad WebSocket address: ${e.message}`);
      return;
    }
    ws.onopen = () => this.onState('on', 'Robot link: WebSocket');
    ws.onmessage = (ev) => this.onMessage(String(ev.data));
    ws.onclose = () => {
      if (this.ws !== ws) return; // closed on purpose
      this.onState('warn', 'Robot not reachable, retrying');
      this._retry = setTimeout(() => this._openWs(url), 4000);
    };
    this.ws = ws;
  }

  disconnect() {
    clearTimeout(this._retry);
    if (this.client) { this.client.end(true); this.client = null; }
    if (this.ws) { const w = this.ws; this.ws = null; w.close(); }
  }

  get connected() {
    if (this.mode === 'mqtt') return Boolean(this.client?.connected);
    if (this.mode === 'ws') return this.ws?.readyState === WebSocket.OPEN;
    return false;
  }

  /** Returns { packet, delivered }. */
  send(cmd) {
    const { type, ...rest } = cmd;
    const packet = { id: ++this.seq, ...rest, ts: Date.now() };
    const json = JSON.stringify(packet);
    let delivered = false;
    if (this.mode === 'mqtt' && this.client?.connected) {
      this.client.publish(`${this.topic}/cmd`, json, { qos: 1 });
      delivered = true;
    } else if (this.mode === 'ws' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(json);
      delivered = true;
    }
    return { packet, delivered };
  }
}
