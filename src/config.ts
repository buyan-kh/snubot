import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
    DISCORD_TOKEN: z.string().min(1, 'Discord token is required'),
    DISCORD_CLIENT_ID: z.string().min(1, 'Discord client ID is required'),
    DISCORD_GUILD_ID: z.string().optional(),
    BRAVE_API_KEY: z.string().min(1, 'Brave API key is required'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
    console.error('Invalid environment variables:');
    console.error(parseResult.error.format());
    process.exit(1);
}

export const config = parseResult.data;
export type Config = z.infer<typeof envSchema>;
