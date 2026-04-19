import pino from 'pino';

const logLevel = process.env['LOG_LEVEL'] ?? 'info';
const transport =
  process.env['NODE_ENV'] !== 'production'
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
    : undefined;

export const logger = pino(
  {
    level: logLevel,
    base: { service: 'dialer-listener' },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport,
);
