export interface SseStreamOptions {
  heartbeatMs: number;
  label?: string;
  onClose?: () => void;
}

export interface SseStream {
  controller: AbortController;
  send: <T>(event: { stage: string; status: string; runId: string; ts: string; data?: T; message?: string }) => void;
  sendJson: (eventName: string, payload: unknown) => void;
  close: () => void;
}
