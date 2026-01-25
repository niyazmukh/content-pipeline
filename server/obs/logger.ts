import type { AppConfig } from '../../shared/config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelWeights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

const emit = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
  const base = {
    level,
    message,
    ts: new Date().toISOString(),
    ...meta,
  };
  const payload = JSON.stringify(base);
  /* eslint-disable no-console */
  if (level === 'error') {
    console.error(payload);
  } else if (level === 'warn') {
    console.warn(payload);
  } else {
    console.log(payload);
  }
  /* eslint-enable no-console */
};

export const createLogger = (config: AppConfig): Logger => {
  const threshold = levelWeights[config.observability.logLevel];
  const shouldLog = (level: LogLevel) => levelWeights[level] >= threshold;
  return {
    debug: (message, meta) => {
      if (shouldLog('debug')) emit('debug', message, meta);
    },
    info: (message, meta) => {
      if (shouldLog('info')) emit('info', message, meta);
    },
    warn: (message, meta) => {
      if (shouldLog('warn')) emit('warn', message, meta);
    },
    error: (message, meta) => emit('error', message, meta),
  };
};

