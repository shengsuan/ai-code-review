import pino from "pino";

export const logger = pino(
  { level: process.env.CRV_LOG_LEVEL ?? "warn", base: undefined },
  pino.destination({ fd: 2, sync: true }),
);
