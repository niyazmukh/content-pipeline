type StreamSseRequestArgs<T> = {
  url: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  mapResult: (eventName: string, payload: unknown) => T | undefined;
  onStageEvent?: (payload: unknown) => void;
};

const safeParseJson = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
};

export const streamSseRequest = async <T>({
  url,
  method = 'POST',
  body,
  headers,
  mapResult,
  onStageEvent,
}: StreamSseRequestArgs<T>): Promise<T> => {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(headers ?? {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed (${res.status})`);
  }

  if (!res.body) {
    throw new Error('Streaming response body not available');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flushFrame = (frame: string) => {
    const lines = frame.split('\n');
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim() || eventName;
        continue;
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
    }

    const data = dataLines.join('\n');
    const payload = safeParseJson(data);

    if (eventName === 'stage-event') {
      onStageEvent?.(payload);
    }

    if (eventName === 'fatal') {
      const message =
        (payload && typeof payload === 'object' && 'error' in payload ? String((payload as any).error) : '') ||
        'Fatal error';
      throw new Error(message);
    }

    const result = mapResult(eventName, payload);
    if (result !== undefined) {
      return result;
    }
    return undefined;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const idx = buffer.indexOf('\n\n');
      if (idx === -1) break;
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const maybeResult = flushFrame(frame);
      if (maybeResult !== undefined) {
        try {
          reader.cancel().catch(() => {});
        } catch {
          // ignore
        }
        return maybeResult;
      }
    }
  }

  throw new Error('Stream ended without a final result');
};

