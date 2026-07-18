import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';

describe('createLogger', () => {
  it('does not call any sink when none is provided (no I/O side effects as a library)', () => {
    const logger = createLogger();
    // Must not throw and must not touch stdout/stderr; nothing to assert on except
    // that calling every level is safe with the default no-op sink.
    expect(() => {
      logger.debug('x');
      logger.info('x');
      logger.warn('x');
      logger.error('x');
    }).not.toThrow();
  });

  it('forwards messages at or above the configured level to the sink', () => {
    const received: Array<{ level: string; message: string }> = [];
    const logger = createLogger('warn', (level, message) => received.push({ level, message }));

    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');

    expect(received).toEqual([
      { level: 'warn', message: 'warn message' },
      { level: 'error', message: 'error message' },
    ]);
  });

  it('defaults to info level when no level is given but a sink is', () => {
    const received: string[] = [];
    const logger = createLogger(undefined, (_level, message) => received.push(message));

    logger.debug('should be filtered out');
    logger.info('should pass through');

    expect(received).toEqual(['should pass through']);
  });
});
