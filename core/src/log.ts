// Tiny leveled logger. No I/O side effects as a library: the default sink is a no-op, so
// importing @blocknet/core and calling analyze() never writes anywhere unless the caller
// (cli.ts, ipc-worker.ts) explicitly wires a sink — see docs/architecture/DIRECTORY-TREE.md.
// Never wire this to stdout: docs/architecture/PROCESS-BOUNDARY.md reserves stdout for the
// structured JSON result; a stray log line there would corrupt that channel.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSink = (level: LogLevel, message: string) => void;

export type Logger = {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const NOOP_SINK: LogSink = () => {};

export function createLogger(minLevel: LogLevel = 'info', sink: LogSink = NOOP_SINK): Logger {
  const threshold = LEVEL_ORDER[minLevel];
  const log = (level: LogLevel, message: string) => {
    if (LEVEL_ORDER[level] >= threshold) sink(level, message);
  };

  return {
    debug: (message: string) => log('debug', message),
    info: (message: string) => log('info', message),
    warn: (message: string) => log('warn', message),
    error: (message: string) => log('error', message),
  };
}
