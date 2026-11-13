// Read a request or response body as UTF-8 text without trusting the other side: stop after maxBytes,
// and give up at an absolute deadline (a server can send headers and then trickle the body for ever).

export class BodyTimeoutError extends Error {
  constructor() {
    super('Timed out reading the response body');
    this.name = 'BodyTimeoutError';
  }
}

function beforeDeadline(promise, deadline) {
  if (!Number.isFinite(deadline)) return promise;
  const ms = deadline - Date.now();
  if (ms <= 0) return Promise.reject(new BodyTimeoutError());
  let t;
  const timer = new Promise((_, reject) => { t = setTimeout(() => reject(new BodyTimeoutError()), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

// Returns { text, bytes, truncated }. When the body is longer than maxBytes, text holds the first maxBytes
// and truncated is true; the rest is never downloaded.
export async function readCapped(body, { maxBytes, deadline = Infinity }) {
  if (!body) return { text: '', bytes: 0, truncated: false };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await beforeDeadline(reader.read(), deadline);
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
      const room = maxBytes - bytes;
      if (chunk.byteLength > room) {
        text += decoder.decode(chunk.subarray(0, room), { stream: true });
        bytes = maxBytes;
        truncated = true;
        break;
      }
      bytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.cancel().catch(() => {});
  }
  return { text, bytes, truncated };
}
