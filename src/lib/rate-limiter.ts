import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { logger } from './logger.js';
import type { Request, Response } from 'express';

// Create a separate Redis client for rate limiting
const redisClient = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 1,
});

redisClient.on('error', (err: Error) => {
    logger.warn('Rate limiter Redis error, falling back to memory:', err.message);
});

/**
 * Create rate limiter for API routes
 */
export const apiRateLimiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: config.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return
        sendCommand: (async (command: string, ...args: string[]) =>
            redisClient.call(command, ...args)) as any,
        prefix: 'rl:api:',
    }),
    keyGenerator: (req: Request): string => {
        // Use Discord user ID if available, otherwise IP
        return req.headers['x-discord-user-id'] as string || req.ip || 'unknown';
    },
    handler: (_req: Request, res: Response) => {
        res.status(429).json({
            success: false,
            error: 'Too many requests. Please wait before making more OSINT queries.',
            retryAfter: Math.ceil(config.RATE_LIMIT_WINDOW_MS / 1000),
        });
    },
    skip: (req: Request) => {
        // Skip rate limiting for health checks
        return req.path === '/health';
    },
});

/**
 * Stricter rate limiter for Discord commands (per user)
 */
export const discordRateLimiter = new Map<string, { count: number; resetAt: number }>();

export function checkDiscordRateLimit(userId: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const userLimit = discordRateLimiter.get(userId);

    if (!userLimit || now > userLimit.resetAt) {
        discordRateLimiter.set(userId, {
            count: 1,
            resetAt: now + config.RATE_LIMIT_WINDOW_MS,
        });
        return { allowed: true };
    }

    if (userLimit.count >= config.RATE_LIMIT_MAX_REQUESTS) {
        return {
            allowed: false,
            retryAfter: Math.ceil((userLimit.resetAt - now) / 1000),
        };
    }

    userLimit.count++;
    return { allowed: true };
}

// Cleanup old entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [userId, limit] of discordRateLimiter) {
        if (now > limit.resetAt) {
            discordRateLimiter.delete(userId);
        }
    }
}, 60000); // Clean up every minute
