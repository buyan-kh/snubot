/**
 * Slash Command Registration
 * Run with: npm run deploy-commands
 */

import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';

// Simple logger for this script (avoid importing lib/index which initializes Redis)
const logger = {
    info: (...args: unknown[]) => console.log('[info]', ...args),
    error: (...args: unknown[]) => console.error('[error]', ...args),
};

const commands = [
    new SlashCommandBuilder()
        .setName('email')
        .setDescription('Check email for breaches and online presence')
        .addStringOption((option) =>
            option
                .setName('address')
                .setDescription('Email address to lookup')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('privacy')
        .setDescription('View privacy policy and legal disclaimer'),

    new SlashCommandBuilder()
        .setName('google')
        .setDescription('Execute a Google search (supports OSINT dorks)')
        .addStringOption((option) =>
            option
                .setName('query')
                .setDescription('Search query or dork (e.g., "username" site:github.com)')
                .setRequired(true)
                .setMinLength(2)
                .setMaxLength(200)
        ),

    new SlashCommandBuilder()
        .setName('recon')
        .setDescription('Full recon - searches X, GitHub, pastes, Reddit, and 30+ platforms at once')
        .addStringOption((option) =>
            option
                .setName('username')
                .setDescription('Username to investigate (X/Twitter handle works best)')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50)
        ),
].map((command) => command.toJSON());

async function deployCommands(): Promise<void> {
    const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

    try {
        logger.info(`Registering ${commands.length} slash commands...`);

        if (config.DISCORD_GUILD_ID) {
            // Guild-specific (instant, for development)
            await rest.put(
                Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
                { body: commands }
            );
            logger.info(`✅ Registered commands to guild: ${config.DISCORD_GUILD_ID}`);
        } else {
            // Global (can take up to 1 hour to propagate)
            await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), {
                body: commands,
            });
            logger.info('✅ Registered global commands (may take up to 1 hour to propagate)');
        }
    } catch (error) {
        logger.error('Failed to register commands:', error);
        process.exit(1);
    }
}

deployCommands();
