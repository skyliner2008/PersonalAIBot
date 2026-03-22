/**
 * Zod Validation Middleware
 * 
 * Reusable validation middleware using Zod schemas.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, AnyZodObject, ZodError, ZodIssue } from 'zod';
import { ValidationError } from '../utils/errorHandler.js';

/**
 * Validate request body against a Zod schema
 */
export const validateBody = (schema: ZodSchema) => validate(schema, 'body');

/**
 * Validate request query parameters against a Zod schema
 */
export const validateQuery = (schema: ZodSchema) => validate(schema, 'query');

/**
 * Validate request URL parameters against a Zod schema
 */
export const validateParams = (schema: ZodSchema) => validate(schema, 'params');

/**
 * Validate multiple request parts at once
 */
export const validate = (schema: ZodSchema, source: 'body' | 'query' | 'params') => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const data = req[source];
      const validated = schema.parse(data);
      
      // Replace the data with validated (and potentially transformed) data
      req[source] = validated;
      
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Format Zod errors into a more readable structure
        const errors = formatZodError(error);
        next(new ValidationError('Validation failed', errors));
      } else {
        next(error);
      }
    }
  };
};

/**
 * Format Zod errors into a structured object
 */
function formatZodError(zodError: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};

  for (const issue of zodError.errors) {
    const path = Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path);
    const message = formatZodIssueMessage(issue);

    if (!errors[path]) {
      errors[path] = [];
    }
    errors[path].push(message);
  }

  return errors;
}

/**
 * Helper functions to format specific Zod issues
 */
function formatInvalidTypeIssue(issue: Extract<ZodIssue, { code: 'invalid_type' }>): string {
  return `Expected ${issue.expected}, got ${issue.received}`;
}

function formatInvalidStringIssue(issue: Extract<ZodIssue, { code: 'invalid_string' }>): string {
  if (issue.validation === 'email') {
    return 'Invalid email format';
  }
  if (issue.validation === 'url') {
    return 'Invalid URL format';
  }
  return `Invalid string format`;
}

function formatTooSmallIssue(issue: Extract<ZodIssue, { code: 'too_small' }>): string {
  if (issue.type === 'string') {
    return `Minimum length is ${issue.minimum} characters`;
  }
  if (issue.type === 'number') {
    return `Minimum value is ${issue.minimum}`;
  }
  if (issue.type === 'array') {
    return `Minimum ${issue.minimum} items required`;
  }
  return `Value is too small`;
}

function formatTooBigIssue(issue: Extract<ZodIssue, { code: 'too_big' }>): string {
  if (issue.type === 'string') {
    return `Maximum length is ${issue.maximum} characters`;
  }
  if (issue.type === 'number') {
    return `Maximum value is ${issue.maximum}`;
  }
  if (issue.type === 'array') {
    return `Maximum ${issue.maximum} items allowed`;
  }
  return `Value is too big`;
}

function formatCustomIssue(issue: Extract<ZodIssue, { code: 'custom' }>, path: string): string {
  return issue.message || `Invalid ${path}`;
}

function formatInvalidEnumValueIssue(issue: Extract<ZodIssue, { code: 'invalid_enum_value' }>): string {
  return `Value must be one of: ${issue.options.join(', ')}`;
}

function formatDefaultIssue(issue: ZodIssue, path: string): string {
  return issue.message || `Invalid ${path}`;
}

/**
 * Format a single Zod issue into a user-friendly message
 */
function formatZodIssueMessage(issue: ZodIssue): string {
  const path = Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path);

  switch (issue.code) {
    case 'invalid_type':
      return formatInvalidTypeIssue(issue);
    case 'invalid_string':
      return formatInvalidStringIssue(issue);
    case 'too_small':
      return formatTooSmallIssue(issue);
    case 'too_big':
      return formatTooBigIssue(issue);
    case 'custom':
      return formatCustomIssue(issue, path);
    case 'invalid_enum_value':
      return formatInvalidEnumValueIssue(issue);
    default:
      return formatDefaultIssue(issue, path);
  }
}

/**
 * Create a partial validation (allows unknown fields)
 */
export const validatePartial = (schema: AnyZodObject) => {
  const partialSchema = schema.partial();
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const data = req.body;
      const validated = partialSchema.parse(data);
      req.body = validated;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = formatZodError(error);
        next(new ValidationError('Validation failed', errors));
      } else {
        next(error);
      }
    }
  };
};

/**
 * Combine multiple validations
 */
export const validateAll = (...validations: ReturnType<typeof validateBody>[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    let index = 0;
    
    const runNext = (err?: any) => {
      if (err) {
        return next(err);
      }
      
      if (index >= validations.length) {
        return next();
      }
      
      const middleware = validations[index++];
      middleware(req, _res, runNext as NextFunction);
    };
    
    runNext();
  };
};

export default {
  validateBody,
  validateQuery,
  validateParams,
  validate,
  validatePartial,
  validateAll,
};
