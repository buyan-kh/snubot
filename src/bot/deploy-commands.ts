import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';

const logger = {
    info: (...args: unknown[]) => console.log('[info]', ...args),
    error: (...args: unknown[]) => console.error('[error]', ...args),
};

const commands = [
    new SlashCommandBuilder()
        .setName('lookup')
        .setDescription('Look up an X.com profile - scrapes tweets, follows links, extracts PII')
        .addStringOption(option =>
            option
                .setName('target')
                .setDescription('X/Twitter username, @handle, or profile URL')
                .setRequired(true)
        ),
].map(command => command.toJSON());

async function deployCommands(): Promise<void> {
    const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

    try {
        logger.info(`Registering ${commands.length} slash command(s)...`);

        if (config.DISCORD_GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
                { body: commands }
            );
            logger.info(`Registered commands to guild: ${config.DISCORD_GUILD_ID}`);
        } else {
            await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), {
                body: commands,
            });
            logger.info('Registered global commands (may take up to 1 hour to propagate)');
        }
    } catch (error) {
        logger.error('Failed to register commands:', error);
        process.exit(1);
    }
}

deployCommands();
