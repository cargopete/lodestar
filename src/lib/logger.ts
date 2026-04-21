import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const betterStackToken = process.env.BETTER_STACK_SOURCE_TOKEN;

function getTransport() {
  if (isDev) {
    return { target: 'pino-pretty', options: { colorize: true } };
  }
  if (betterStackToken) {
    return {
      targets: [
        { target: 'pino/file', options: { destination: 1 }, level: 'info' },
        { target: '@logtail/pino', options: { sourceToken: betterStackToken }, level: 'info' },
      ],
    };
  }
  return undefined;
}

/**
 * Root logger — JSON in production, pretty in dev.
 * Ships to Better Stack in production when BETTER_STACK_SOURCE_TOKEN is set.
 * Create child loggers with `logger.child({ module: 'xxx' })`.
 */
const transport = getTransport();
const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  ...(transport && { transport }),
});

// Pre-built child loggers for common modules
export const log = {
  api: logger.child({ module: 'api' }),
  cron: logger.child({ module: 'cron' }),
  ingest: logger.child({ module: 'ingest' }),
  cache: logger.child({ module: 'cache' }),
  health: logger.child({ module: 'health' }),
  refresh: logger.child({ module: 'refresh' }),
  amp: logger.child({ module: 'amp' }),
};

export default logger;
