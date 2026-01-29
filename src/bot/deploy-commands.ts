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
        .setName('x')
        .setDescription('Lookup an X/Twitter profile')
        .addStringOption((option) =>
            option
                .setName('username')
                .setDescription('X/Twitter username (without @)')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50)
        ),

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
        .setName('username')
        .setDescription('Search for a username across multiple platforms')
        .addStringOption((option) =>
            option
                .setName('handle')
                .setDescription('Username to search')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50)
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
        .setName('deeprecon')
        .setDescription('Deep reconnaissance on X/Twitter - scrapes tweets, follows links, extracts PII')
        .addStringOption((option) =>
            option
                .setName('username')
                .setDescription('X/Twitter username to investigate')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50)
        )
        .addIntegerOption((option) =>
            option
                .setName('tweets')
                .setDescription('Number of tweets to analyze (default: 30)')
                .setRequired(false)
                .setMinValue(5)
                .setMaxValue(100)
        )
        .addBooleanOption((option) =>
            option
                .setName('crawl_links')
                .setDescription('Crawl external links for more intel (default: true)')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('github')
        .setDescription('Search GitHub for code, commits, and profiles associated with a query')
        .addStringOption((option) =>
            option
                .setName('query')
                .setDescription('Username, email, or search term to investigate')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(100)
        )
        .addStringOption((option) =>
            option
                .setName('type')
                .setDescription('Search type')
                .setRequired(false)
                .addChoices(
                    { name: 'Auto-detect', value: 'auto' },
                    { name: 'Code Search', value: 'code' },
                    { name: 'User Profile', value: 'user' },
                    { name: 'Commit Search', value: 'commits' }
                )
        ),

    new SlashCommandBuilder()
        .setName('pastes')
        .setDescription('Search paste sites for leaked data (Pastebin, Ghostbin, etc.)')
        .addStringOption((option) =>
            option
                .setName('query')
                .setDescription('Username, email, or search term to find')
                .setRequired(true)
                .setMinLength(2)
                .setMaxLength(100)
        )
        .addBooleanOption((option) =>
            option
                .setName('analyze')
                .setDescription('Analyze paste content for sensitive data (default: true)')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('reddit')
        .setDescription('Investigate a Reddit user profile and post history')
        .addStringOption((option) =>
            option
                .setName('username')
                .setDescription('Reddit username to investigate')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50)
        )
        .addIntegerOption((option) =>
            option
                .setName('posts')
                .setDescription('Number of posts to analyze (default: 25)')
                .setRequired(false)
                .setMinValue(5)
                .setMaxValue(100)
        ),

    new SlashCommandBuilder()
        .setName('discord')
        .setDescription('Search for a Discord handle across GitHub and paste sites')
        .addStringOption((option) =>
            option
                .setName('handle')
                .setDescription('Discord username (e.g., username or username#1234)')
                .setRequired(true)
                .setMinLength(2)
                .setMaxLength(40)
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
