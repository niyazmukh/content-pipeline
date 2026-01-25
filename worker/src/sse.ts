import type { SseStreamOptions, SseStream } from '../../shared/sse';

export const createWorkerSseStream = (options: SseStreamOptions): { stream: ReadableStream; sse: SseStream } => {
  const controller = new AbortController();
  const encoder = new TextEncoder();
  let closed = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

  const writeFrame = (eventName: string, payload: unknown) => {
    if (closed || !streamController) {
      return;
    }
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const frame = `event: ${eventName}\n` + `data: ${data}\n\n`;
    streamController.enqueue(encoder.encode(frame));
  };

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    try {
      controller.abort();
    } catch {
      // ignore
    }
    try {
      streamController?.close();
    } catch {
      // ignore
    }
    try {
      options.onClose?.();
    } catch {
      // ignore
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      streamController = ctrl;
    },
    cancel() {
      close();
    },
  });

  const heartbeat = setInterval(() => {
    if (closed || !streamController) return;
    streamController.enqueue(encoder.encode(': heartbeat\n\n'));
  }, options.heartbeatMs);

  const sse: SseStream = {
    controller,
    send: (event) => writeFrame('stage-event', event),
    sendJson: (eventName: string, payload: unknown) => writeFrame(eventName, payload),
    close,
  };

  return { stream, sse };
};
