import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
    // Discord
    DISCORD_TOKEN: z.string().min(1, 'Discord token is required'),
    DISCORD_CLIENT_ID: z.string().min(1, 'Discord client ID is required'),
    DISCORD_GUILD_ID: z.string().optional(),

    // Redis
    REDIS_URL: z.string().default('redis://localhost:6379'),

    // OSINT APIs
    HIBP_API_KEY: z.string().optional(),
    SERPAPI_KEY: z.string().optional(),

    // Rate Limiting
    RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(10),

    // Cache TTL (seconds)
    CACHE_TTL_PROFILE: z.coerce.number().default(3600),
    CACHE_TTL_EMAIL: z.coerce.number().default(3600),
    CACHE_TTL_USERNAME: z.coerce.number().default(3600),

    // Server
    API_PORT: z.coerce.number().default(Number(process.env.PORT) || 3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parseResult.error.format());
    process.exit(1);
}

export const config = parseResult.data;
export type Config = z.infer<typeof envSchema>;
