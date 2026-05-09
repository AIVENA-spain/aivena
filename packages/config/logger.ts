import { Logtail } from '@logtail/node';
import { LogtailTransport } from '@logtail/winston';
import winston from 'winston';
import { env } from './env';

const logtail = new Logtail(env.BETTERSTACK_SOURCE_TOKEN);

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.format.Console(),
    new LogtailTransport(logtail),
  ],
});