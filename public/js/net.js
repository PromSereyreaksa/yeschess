// WebSocket client with automatic reconnect. The app re-joins its room in onOpen.
export class Net {
  constructor({ onOpen, onMessage, onStatus }) {
    this.h = { onOpen, onMessage, onStatus };
    this.retry = 0;
    this.closed = false;
    this.connect();
    this.onVis = () => { if (document.visibilityState === 'visible' && !this.isOpen()) this.reconnectNow(); };
    document.addEventListener('visibilitychange', this.onVis);
    this.ping = setInterval(() => this.send({ t: 'ping' }), 20_000);
  }

  isOpen() { return this.ws?.readyState === 1; }

  connect() {
    if (this.closed) return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = (this.ws = new WebSocket(url));
    ws.onopen = () => {
      this.retry = 0;
      this.h.onStatus?.('online');
      this.h.onOpen?.();
    };
    ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.h.onMessage?.(msg);
    };
    ws.onclose = () => {
      if (this.closed || ws !== this.ws) return;
      this.h.onStatus?.('reconnecting');
      const delay = Math.min(500 * 2 ** this.retry++, 5000);
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  reconnectNow() {
    clearTimeout(this.timer);
    try { this.ws?.close(); } catch { /* ignore */ }
    this.connect();
  }

  send(msg) {
    if (!this.isOpen()) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    clearInterval(this.ping);
    document.removeEventListener('visibilitychange', this.onVis);
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}
