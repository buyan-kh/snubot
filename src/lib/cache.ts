import { Redis } from 'ioredis';
import { config } from '../config.js';
import { logger } from './logger.js';

class CacheClient {
    private redis: Redis;
    private connected: boolean = false;

    constructor() {
        this.redis = new Redis(config.REDIS_URL, {
            retryStrategy: (times: number) => {
                if (times > 3) {
                    logger.warn('Redis connection failed, continuing without cache');
                    return null;
                }
                return Math.min(times * 200, 2000);
            },
            maxRetriesPerRequest: 3,
        });

        this.redis.on('connect', () => {
            this.connected = true;
            logger.info('✅ Connected to Redis');
        });

        this.redis.on('error', (err: Error) => {
            this.connected = false;
            logger.error('Redis error:', err);
        });

        this.redis.on('close', () => {
            this.connected = false;
            logger.warn('Redis connection closed');
        });
    }

    private generateKey(type: string, identifier: string): string {
        return `osint:${type}:${identifier.toLowerCase()}`;
    }

    async get<T>(type: string, identifier: string): Promise<T | null> {
        if (!this.connected) return null;

        try {
            const key = this.generateKey(type, identifier);
            const data = await this.redis.get(key);
            if (data) {
                logger.debug(`Cache hit: ${key}`);
                return JSON.parse(data) as T;
            }
            return null;
        } catch (error) {
            logger.error('Cache get error:', error);
            return null;
        }
    }

    async set<T>(type: string, identifier: string, data: T, ttlSeconds?: number): Promise<void> {
        if (!this.connected) return;

        try {
            const key = this.generateKey(type, identifier);
            const ttl = ttlSeconds ?? this.getDefaultTtl(type);
            await this.redis.setex(key, ttl, JSON.stringify(data));
            logger.debug(`Cache set: ${key} (TTL: ${ttl}s)`);
        } catch (error) {
            logger.error('Cache set error:', error);
        }
    }

    async delete(type: string, identifier: string): Promise<void> {
        if (!this.connected) return;

        try {
            const key = this.generateKey(type, identifier);
            await this.redis.del(key);
            logger.debug(`Cache delete: ${key}`);
        } catch (error) {
            logger.error('Cache delete error:', error);
        }
    }

    private getDefaultTtl(type: string): number {
        switch (type) {
            case 'x_profile':
                return config.CACHE_TTL_PROFILE;
            case 'email':
                return config.CACHE_TTL_EMAIL;
            case 'username':
                return config.CACHE_TTL_USERNAME;
            default:
                return 3600; // 1 hour default
        }
    }

    isConnected(): boolean {
        return this.connected;
    }

    async disconnect(): Promise<void> {
        await this.redis.quit();
        this.connected = false;
    }
}

export const cache = new CacheClient();
