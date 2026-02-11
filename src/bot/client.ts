import { Client, GatewayIntentBits, Collection, type Interaction } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../lib/index.js';
import type { Command } from './types.js';
import lookupCommand from './commands/lookup.js';

export function createClient(): Client {
    const client = new Client({
        intents: [GatewayIntentBits.Guilds],
    });

    const commands = new Collection<string, Command>();
    commands.set(lookupCommand.data.name, lookupCommand);

    (client as Client & { commands: Collection<string, Command> }).commands = commands;

    client.once('ready', (readyClient) => {
        logger.info(`Bot ready as ${readyClient.user.tag}`);
        logger.info(`Connected to ${readyClient.guilds.cache.size} guild(s)`);
    });

    client.on('interactionCreate', async (interaction: Interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const command = commands.get(interaction.commandName);
        if (!command) {
            logger.warn(`Unknown command: ${interaction.commandName}`);
            return;
        }

        try {
            logger.info(`Command: /${interaction.commandName}`, {
                user: interaction.user.tag,
                guild: interaction.guild?.name ?? 'DM',
                options: interaction.options.data.map(o => `${o.name}=${o.value}`),
            });

            await command.execute(interaction);
        } catch (error) {
            logger.error(`Command error: /${interaction.commandName}`, error);

            const errorMessage = 'An error occurred while executing this command.';

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    });

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
