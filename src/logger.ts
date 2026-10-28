type Level = 'info' | 'warn' | 'error';

function write(level: Level, message: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

/** Minimal structured (JSON lines) logger. */
export const logger = {
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
};

/**
 * Turns an unknown thrown value into a readable message.
 *
 * @param error - Anything that was thrown
 * @returns The error message
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
