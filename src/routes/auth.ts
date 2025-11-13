// src/routes/auth.ts
import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { sendVerificationEmail, sendPasswordResetEmail } from '../config/email';
import {
  registerValidation,
  loginValidation,
  passwordResetRequestValidation,
  passwordResetValidation,
  validateRequest,
} from '../middleware/validator';
import { authLimiter } from '../middleware/rateLimiter';

const router = express.Router();

// Register
router.post(
  '/register',
  authLimiter,
  registerValidation,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { email, password, name } = req.body;

      const existingUser = await query('SELECT id FROM users WHERE email = $1', [email]);
      if (existingUser.rows.length > 0) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const result = await query(
        'INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name',
        [email, hashedPassword, name]
      );

      const user = result.rows[0];

      const verificationToken = uuidv4();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await query(
        'INSERT INTO verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [user.id, verificationToken, expiresAt]
      );

      await sendVerificationEmail(email, verificationToken);

      res.status(201).json({
        message: 'Registration successful! Please check your email to verify your account.',
        user: { id: user.id, email: user.email, name: user.name },
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
);

// Verify Email
router.get('/verify-email/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    const result = await query(
      'SELECT user_id, expires_at FROM verification_tokens WHERE token = $1',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid verification token' });
    }

    const { user_id, expires_at } = result.rows[0];

    if (new Date() > new Date(expires_at)) {
      return res.status(400).json({ error: 'Verification token expired' });
    }

    await query('UPDATE users SET is_verified = TRUE WHERE id = $1', [user_id]);
    await query('DELETE FROM verification_tokens WHERE token = $1', [token]);

    res.json({ message: 'Email verified successfully! You can now login.' });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});
// Login
router.post(
  '/login',
  authLimiter,
  loginValidation,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      const result = await query(
        'SELECT id, email, password, name, is_verified FROM users WHERE email = $1',
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = result.rows[0];

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      if (!user.is_verified) {
        return res.status(403).json({ error: 'Please verify your email before logging in' });
      }

      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        throw new Error('JWT_SECRET is not defined');
      }

      const token = jwt.sign(
        { userId: user.id, email: user.email },
        jwtSecret,
        { expiresIn: process.env.JWT_EXPIRY || '7d' } as any
      );

      res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name },
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

// Request Password Reset
router.post(
  '/forgot-password',
  authLimiter,
  passwordResetRequestValidation,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { email } = req.body;

      const result = await query('SELECT id FROM users WHERE email = $1', [email]);

      if (result.rows.length === 0) {
        return res.json({ message: 'If the email exists, a reset link has been sent' });
      }

      const userId = result.rows[0].id;
      const resetToken = uuidv4();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await query(
        'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [userId, resetToken, expiresAt]
      );

      await sendPasswordResetEmail(email, resetToken);

      res.json({ message: 'If the email exists, a reset link has been sent' });
    } catch (error) {
      console.error('Password reset request error:', error);
      res.status(500).json({ error: 'Request failed' });
    }
  }
);

// Reset Password
router.post(
  '/reset-password',
  passwordResetValidation,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { token, newPassword } = req.body;

      const result = await query(
        'SELECT user_id, expires_at, used FROM password_reset_tokens WHERE token = $1',
        [token]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid reset token' });
      }

      const { user_id, expires_at, used } = result.rows[0];

      if (used) {
        return res.status(400).json({ error: 'Token already used' });
      }

      if (new Date() > new Date(expires_at)) {
        return res.status(400).json({ error: 'Reset token expired' });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, user_id]);
      await query('UPDATE password_reset_tokens SET used = TRUE WHERE token = $1', [token]);

      res.json({ message: 'Password reset successful! You can now login.' });
    } catch (error) {
      console.error('Password reset error:', error);
      res.status(500).json({ error: 'Password reset failed' });
    }
  }
);

export default router;