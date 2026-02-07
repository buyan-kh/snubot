/**
 * /phone command - Find phone numbers only
 * No noise, just phones
 */

import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { searchForPhone } from '../../modules/phone-discovery.js';
import { logger } from '../../lib/index.js';
import type { Command } from '../types.js';

const command: Command = {
    data: new SlashCommandBuilder()
        .setName('phone')
        .setDescription('🔍 Find phone numbers for a username (focused search)')
        .addStringOption(opt =>
            opt.setName('username')
                .setDescription('Twitter/X username to search')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('email')
                .setDescription('Email address (helps find correlations)')
                .setRequired(false)
        )
        .addStringOption(opt =>
            opt.setName('name')
                .setDescription('Real name (for people search sites)')
                .setRequired(false)
        ) as SlashCommandBuilder,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const username = interaction.options.getString('username', true).replace('@', '');
        const email = interaction.options.getString('email') ?? undefined;
        const realName = interaction.options.getString('name') ?? undefined;

        await interaction.deferReply();

        logger.info(`Phone search started for: ${username}`);

        try {
            const result = await searchForPhone(username, { email, realName });

            const embed = new EmbedBuilder()
                .setTitle(`📱 Phone Search: @${username}`)
                .setColor(result.phones.length > 0 ? 0x00ff00 : 0xff6600)
                .setTimestamp();

            if (result.phones.length > 0) {
                const phoneList = result.phones.slice(0, 10).map(p =>
                    `📞 **${p.formatted}**\n` +
                    `└ Source: [${p.source}](${p.sourceUrl}) (${p.confidence})`
                ).join('\n\n');

                embed.setDescription(`**Found ${result.phones.length} phone number(s):**\n\n${phoneList}`);

                if (result.phones.length > 10) {
                    embed.addFields({
                        name: '📋 Additional Results',
                        value: `+${result.phones.length - 10} more phone(s) found`,
                        inline: false
                    });
                }
            } else {
                embed.setDescription(
                    '❌ **No phone numbers found**\n\n' +
                    '**Tips to improve results:**\n' +
                    '• Try with their email: `/phone username:x email:their@email.com`\n' +
                    '• Try with real name: `/phone username:x name:John Doe`\n' +
                    '• Phone may not be publicly linked to this account\n\n' +
                    '**What we searched:**\n' +
                    '• Twitter/X bio & linked website\n' +
                    '• Leaked data aggregators\n' +
                    '• IntelX database'
                );
            }

            embed.addFields({
                name: '🔍 Sources Checked',
                value: result.sourcesChecked.join('\n'),
                inline: false
            });

            embed.setFooter({ text: `Completed in ${(result.executionTimeMs / 1000).toFixed(1)}s` });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            logger.error('Phone command failed:', error);
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('❌ Search Failed')
                        .setDescription('An error occurred during phone search.')
                        .setColor(0xff0000)
                ]
            });
        }
    },
};

export default command;
