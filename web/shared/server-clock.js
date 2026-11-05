// NTP-style estimate from heartbeat responses. No wall-clock dependency or per-frame request.
export function createServerClock(monotonicNow = () => performance.now()) {
  let sequence = 0;
  const pending = new Map();
  let samples = [], lastResponse = -Infinity;
  const maxAge = 10000;
  return {
    ping() {
      const id = ++sequence;
      pending.set(id, monotonicNow());
      while (pending.size > 8) pending.delete(pending.keys().next().value);
      return id;
    },
    receive(message) {
      const received = monotonicNow(), sent = pending.get(message.ping_id);
      pending.delete(message.ping_id);
      const a = message.server_received_ms, b = message.server_sent_ms;
      if (sent === undefined || !Number.isFinite(a) || !Number.isFinite(b) || b < a || received < sent) return false;
      const rtt = (received - sent) - (b - a);
      if (rtt < 0 || rtt > 5000) return false;
      samples = samples.filter(sample => received - sample.at <= maxAge);
      samples.push({ at: received, offset: (a + b - sent - received) / 2, rtt });
      lastResponse = received;
      return true;
    },
    estimate() {
      const now = monotonicNow();
      samples = samples.filter(sample => now - sample.at <= maxAge);
      if (!samples.length || now - lastResponse > maxAge) return null;
      const best = samples.reduce((a, b) => a.rtt <= b.rtt ? a : b);
      return { nowMs: now + best.offset, uncertaintyMs: best.rtt / 2 };
    },
  };
}
