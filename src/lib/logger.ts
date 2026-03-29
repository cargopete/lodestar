import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Root logger — JSON in production, pretty in dev.
 * Create child loggers with `logger.child({ module: 'xxx' })`.
 */
const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  ...(isDev
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

// Pre-built child loggers for common modules
export const log = {
  cron: logger.child({ module: 'cron' }),
  ingest: logger.child({ module: 'ingest' }),
  cache: logger.child({ module: 'cache' }),
  health: logger.child({ module: 'health' }),
  refresh: logger.child({ module: 'refresh' }),
};

export default logger;
