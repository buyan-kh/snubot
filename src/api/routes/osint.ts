import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { logger, cache } from '../../lib/index.js';
import { lookupXProfile } from '../../modules/x-twitter.js';
import { lookupEmail } from '../../modules/email-osint.js';
import { lookupUsername } from '../../modules/username-crosscheck.js';
import type { OsintModuleResult, XProfileResult, EmailResult, UsernameResult } from '../../types/index.js';

export const osintRouter = Router();

// Input validation schemas
const usernameSchema = z.string().min(1).max(50).regex(/^[a-zA-Z0-9_]+$/);
const emailSchema = z.string().email();

/**
 * GET /api/osint/x/:username
 * Lookup X/Twitter profile by username
 */
osintRouter.get('/x/:username', async (req: Request, res: Response): Promise<void> => {
    try {
        const parseResult = usernameSchema.safeParse(req.params.username);
        if (!parseResult.success) {
            res.status(400).json({
                success: false,
                error: 'Invalid username format. Use only letters, numbers, and underscores.',
            });
            return;
        }

        const username = parseResult.data.toLowerCase();

        // Check cache first
        const cached = await cache.get<XProfileResult>('x_profile', username);
        if (cached) {
            const result: OsintModuleResult<XProfileResult> = {
                success: true,
                data: cached,
                error: null,
                cached: true,
                timestamp: new Date().toISOString(),
            };
            res.json(result);
            return;
        }

        // Perform lookup
        logger.info(`X profile lookup: @${username}`);
        const data = await lookupXProfile(username);

        // Cache success results
        if (data.errors.length === 0) {
            await cache.set('x_profile', username, data);
        }

        const result: OsintModuleResult<XProfileResult> = {
            success: true,
            data,
            error: null,
            cached: false,
            timestamp: new Date().toISOString(),
        };
        res.json(result);
    } catch (error) {
        logger.error('X lookup error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            cached: false,
            timestamp: new Date().toISOString(),
        });
    }
});

/**
 * GET /api/osint/email/:email
 * Lookup email for breaches, gravatar, etc.
 */
osintRouter.get('/email/:email', async (req: Request, res: Response): Promise<void> => {
    try {
        const parseResult = emailSchema.safeParse(req.params.email);
        if (!parseResult.success) {
            res.status(400).json({
                success: false,
                error: 'Invalid email format.',
            });
            return;
        }

        const email = parseResult.data.toLowerCase();

        // Check cache first
        const cached = await cache.get<EmailResult>('email', email);
        if (cached) {
            const result: OsintModuleResult<EmailResult> = {
                success: true,
                data: cached,
                error: null,
                cached: true,
                timestamp: new Date().toISOString(),
            };
            res.json(result);
            return;
        }

        // Perform lookup
        logger.info(`Email lookup: ${email}`);
        const data = await lookupEmail(email);

        // Cache success results
        if (data.errors.length === 0) {
            await cache.set('email', email, data);
        }

        const result: OsintModuleResult<EmailResult> = {
            success: true,
            data,
            error: null,
            cached: false,
            timestamp: new Date().toISOString(),
        };
        res.json(result);
    } catch (error) {
        logger.error('Email lookup error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            cached: false,
            timestamp: new Date().toISOString(),
        });
    }
});

/**
 * GET /api/osint/username/:username
 * Cross-platform username search
 */
osintRouter.get('/username/:username', async (req: Request, res: Response): Promise<void> => {
    try {
        const parseResult = usernameSchema.safeParse(req.params.username);
        if (!parseResult.success) {
            res.status(400).json({
                success: false,
                error: 'Invalid username format. Use only letters, numbers, and underscores.',
            });
            return;
        }

        const username = parseResult.data.toLowerCase();

        // Check cache first
        const cached = await cache.get<UsernameResult>('username', username);
        if (cached) {
            const result: OsintModuleResult<UsernameResult> = {
                success: true,
                data: cached,
                error: null,
                cached: true,
                timestamp: new Date().toISOString(),
            };
            res.json(result);
            return;
        }

        // Perform lookup
        logger.info(`Username cross-platform lookup: ${username}`);
        const data = await lookupUsername(username);

        // Cache success results
        if (data.errors.length === 0) {
            await cache.set('username', username, data);
        }

        const result: OsintModuleResult<UsernameResult> = {
            success: true,
            data,
            error: null,
            cached: false,
            timestamp: new Date().toISOString(),
        };
        res.json(result);
    } catch (error) {
        logger.error('Username lookup error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            cached: false,
            timestamp: new Date().toISOString(),
        });
    }
});
