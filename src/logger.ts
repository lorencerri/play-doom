import pino from 'pino';
import { config } from './config.ts';

// Plain JSON to stdout — Docker captures it, journald stores it. No pretty-printing
// in production; this is the log the next crash needs to be diagnosable from.
export const logger = pino({
	level: config.LOG_LEVEL,
	base: { service: 'play-doom' },
});
