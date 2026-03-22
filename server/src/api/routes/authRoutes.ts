import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { validateBody } from '../../utils/validation.js';
import { login as authLogin, requireAuth } from '../../utils/auth.js';

const authLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().optional(),
});

const authRoutes = Router();
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // Limit each IP to 100 requests per 5 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 5 minutes and try again.' },
});

authRoutes.post('/auth/login', loginLimiter, validateBody(authLoginSchema), async (req, res) => {
  const { username, password } = req.body;
  try {
    // Ensure secure hashing is handled by authLogin before comparison
    const result = await authLogin(username, password);
    if (!result) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({ data: result, error: null });
  } catch (error: unknown) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * RBAC (Role-Based Access Control) Configuration
 * Defines granular roles and permissions for the application.
 */
export type UserRole = 'admin' | 'manager' | 'editor' | 'viewer' | 'user';

export interface CustomRequest extends Request {
  user?: {
    id?: string;
    username: string;
    role: UserRole | string;
    permissions?: string[];
  };
}

/**
 * Middleware to check for specific permissions.
 * Admin role bypasses permission checks.
 */
export const checkPermissions = (requiredPermissions: string[]) => {
  return (req: CustomRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.user.role === 'admin') {
      return next();
    }

    const userPermissions = req.user.permissions || [];
    const hasAll = requiredPermissions.every(p => userPermissions.includes(p));

    if (!hasAll) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

authRoutes.get('/auth/me', requireAuth(), (req: CustomRequest, res) => {
  res.json({ user: req.user });
});

export default authRoutes;
