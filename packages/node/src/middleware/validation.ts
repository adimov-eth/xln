import { Request, Response, NextFunction } from 'express';
import { ParamsDictionary } from 'express-serve-static-core';
import { ParsedQs } from 'qs';
import { z } from 'zod';
import { Logger } from '../utils/Logger';

const logger = new Logger({ name: 'Validation' });

/**
 * Validate request body against a Zod schema
 */
export function validateRequest<T>(schema: z.ZodType<T>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedData = await schema.parseAsync(req.body);
      req.body = validatedData;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('Validation error:', error.errors);
        res.status(400).json({
          status: 'error',
          message: 'Invalid request data',
          errors: error.errors,
        });
      } else {
        next(error);
      }
    }
  };
}

/**
 * Validate request parameters against a Zod schema
 */
export function validateParams<T extends ParamsDictionary>(schema: z.ZodType<T>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedData = await schema.parseAsync(req.params);
      req.params = validatedData;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('Parameter validation error:', error.errors);
        res.status(400).json({
          status: 'error',
          message: 'Invalid request parameters',
          errors: error.errors,
        });
      } else {
        next(error);
      }
    }
  };
}

/**
 * Validate request query against a Zod schema
 */
export function validateQuery<T extends ParsedQs>(schema: z.ZodType<T>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedData = await schema.parseAsync(req.query);
      req.query = validatedData;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('Query validation error:', error.errors);
        res.status(400).json({
          status: 'error',
          message: 'Invalid query parameters',
          errors: error.errors,
        });
      } else {
        next(error);
      }
    }
  };
}
