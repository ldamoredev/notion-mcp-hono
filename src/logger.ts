/**
 * Minimal structured logger: one JSON line per event on stdout, which Railway
 * captures and indexes. Never log secrets or tool arguments (page content).
 */

export type LogFields = Record<string, unknown>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/** Default for tests and any context where log output is unwanted. */
export const silentLogger: Logger = { info() {}, error() {} };

export function createLogger(sink: (line: string) => void = (line) => console.log(line)): Logger {
  const emit = (level: 'info' | 'error', event: string, fields?: LogFields): void => {
    sink(JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }));
  };
  return {
    info: (event, fields) => emit('info', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}
