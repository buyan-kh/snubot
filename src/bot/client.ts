/**
 * Discord.js Client Configuration
 */

import { Client, GatewayIntentBits, Collection, type Interaction } from 'discord.js';
import { config } from '../config.js';
import { logger, checkDiscordRateLimit } from '../lib/index.js';
import type { Command } from './types.js';

// Import commands
import xCommand from './commands/x.js';
import emailCommand from './commands/email.js';
import usernameCommand from './commands/username.js';
import privacyCommand from './commands/privacy.js';
import googleCommand from './commands/google.js';
import deepreconCommand from './commands/deeprecon.js';
import githubCommand from './commands/github.js';
import pastesCommand from './commands/pastes.js';
import redditCommand from './commands/reddit.js';
import discordCommand from './commands/discord.js';
import reconCommand from './commands/recon.js';

export function createClient(): Client {
    const client = new Client({
        intents: [GatewayIntentBits.Guilds],
    });

    // Create commands collection
    const commands = new Collection<string, Command>();
    commands.set(xCommand.data.name, xCommand);
    commands.set(emailCommand.data.name, emailCommand);
    commands.set(usernameCommand.data.name, usernameCommand);
    commands.set(privacyCommand.data.name, privacyCommand);
    commands.set(googleCommand.data.name, googleCommand);
    commands.set(deepreconCommand.data.name, deepreconCommand);
    commands.set(githubCommand.data.name, githubCommand);
    commands.set(pastesCommand.data.name, pastesCommand);
    commands.set(redditCommand.data.name, redditCommand);
    commands.set(discordCommand.data.name, discordCommand);
    commands.set(reconCommand.data.name, reconCommand);

    // Attach to client for access in handlers
    (client as Client & { commands: Collection<string, Command> }).commands = commands;

    // Ready event
    client.once('ready', (readyClient) => {
        logger.info(`🤖 Discord bot ready as ${readyClient.user.tag}`);
        logger.info(`📡 Connected to ${readyClient.guilds.cache.size} guild(s)`);
    });

    // Interaction handler
    client.on('interactionCreate', async (interaction: Interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const command = commands.get(interaction.commandName);
        if (!command) {
            logger.warn(`Unknown command: ${interaction.commandName}`);
            return;
        }

        // Rate limiting
        const rateCheck = checkDiscordRateLimit(interaction.user.id);
        if (!rateCheck.allowed) {
            await interaction.reply({
                content: `⏳ Rate limited. Please wait ${rateCheck.retryAfter} seconds before making more OSINT queries.`,
                ephemeral: true,
            });
            return;
        }

        try {
            logger.info(`Command: /${interaction.commandName}`, {
                user: interaction.user.tag,
                guild: interaction.guild?.name ?? 'DM',
                options: interaction.options.data.map((o) => `${o.name}=${o.value}`),
            });

            await command.execute(interaction);
        } catch (error) {
            logger.error(`Command error: /${interaction.commandName}`, error);

            const errorMessage = '❌ An error occurred while executing this command.';

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    });

    // Error handling
    client.on('error', (error) => {
        logger.error('Discord client error:', error);
    });

    client.on('warn', (message) => {
        logger.warn('Discord client warning:', message);
    });

    return client;
}

export async function startBot(): Promise<Client> {
    const client = createClient();
    await client.login(config.DISCORD_TOKEN);
    return client;
}
