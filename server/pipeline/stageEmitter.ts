export type { StageEvent, StageName, StageStatus } from '../../shared/types';

import type { StageEvent, StageName } from '../../shared/types';

export type StageEventSender = <T>(event: StageEvent<T>) => void;

const nowIso = () => new Date().toISOString();

export const makeStageEmitter = (runId: string, stage: StageName, send: StageEventSender) => ({
  start: <T>(payload?: { message?: string; data?: T }) => {
    send({
      runId,
      stage,
      status: 'start',
      message: payload?.message,
      data: payload?.data,
      ts: nowIso(),
    });
  },
  progress: <T>(payload?: { message?: string; data?: T }) => {
    send({
      runId,
      stage,
      status: 'progress',
      message: payload?.message,
      data: payload?.data,
      ts: nowIso(),
    });
  },
  success: <T>(payload?: { message?: string; data?: T }) => {
    send({
      runId,
      stage,
      status: 'success',
      message: payload?.message,
      data: payload?.data,
      ts: nowIso(),
    });
  },
  failure: (error: unknown, options?: { data?: unknown }) => {
    const message = error instanceof Error ? error.message : String(error);
    send({
      runId,
      stage,
      status: 'failure',
      message,
      data: options?.data ?? { error: message },
      ts: nowIso(),
    });
  },
});
