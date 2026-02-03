import type { Response } from 'express';
import type { SseStreamOptions, SseStream } from '../../shared/sse';

export const createSseStream = (res: Response, options: SseStreamOptions): SseStream => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const controller = new AbortController();
  let closed = false;

  const heartbeat = setInterval(() => {
    if (closed) {
      return;
    }
    try {
      res.write(': heartbeat\n\n');
    } catch (err) {
      // Ignore failures; be defensive about socket state.
    }
  }, options.heartbeatMs);

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(heartbeat);
    try {
      controller.abort();
    } catch (error) {
      // no-op
    }
    try {
      res.end();
    } catch (error) {
      // no-op
    }
    try {
      options.onClose?.();
    } catch (error) {
      // Swallow observer errors.
    }
  };

  res.on('close', close);

  const writeFrame = (eventName: string, payload: unknown) => {
    if (closed) {
      return;
    }

    const data =
      typeof payload === 'string'
        ? payload
        : JSON.stringify(payload);

    try {
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${data}\n\n`);
    } catch (error) {
      close();
      throw error;
    }
  };

  return {
    controller,
    send: (event) => writeFrame('stage-event', event),
    sendJson: (eventName, payload) => writeFrame(eventName, payload),
    close,
  };
};
