import pino from 'pino'

export interface ILogger {
  debug: (...a: any[]) => void
  info:  (...a: any[]) => void
  warn:  (...a: any[]) => void
  error: (...a: any[]) => void
}

export const makeLogger = (level: pino.Level = 'info'): ILogger =>
  pino({
    level,
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss.l' },
    },
  })
