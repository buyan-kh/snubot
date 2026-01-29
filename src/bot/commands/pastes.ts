/**
 * /pastes command - Paste site OSINT search
 */

import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { searchPastes } from '../../modules/paste-search.js';
import type { Command } from '../types.js';

const command: Command = {
    data: new SlashCommandBuilder()
        .setName('pastes')
        .setDescription('Search paste sites for leaked data (Pastebin, Ghostbin, etc.)')
        .addStringOption((option) =>
            option
                .setName('query')
                .setDescription('Email, username, or search term')
                .setRequired(true)
                .setMinLength(3)
                .setMaxLength(100)
        )
        .addBooleanOption((option) =>
            option
                .setName('analyze')
                .setDescription('Analyze paste contents for sensitive data (default: true)')
                .setRequired(false)
        ) as SlashCommandBuilder,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const query = interaction.options.getString('query', true).trim();
        const analyze = interaction.options.getBoolean('analyze') ?? true;

        await interaction.deferReply();

        try {
            await interaction.editReply({
                content: `🔍 Searching paste sites for "${query}"... This may take a minute.`,
            });

            const result = await searchPastes(query, {
                searchGoogle: true,
                searchPastebinDirect: true,
                analyzePastes: analyze,
                maxPastesToAnalyze: 3,
            });

            const embeds: EmbedBuilder[] = [];

            // Main results embed
            const mainEmbed = new EmbedBuilder()
                .setTitle('📋 Paste Site Search')
                .setDescription(`Found **${result.results.length}** pastes for \`${query}\``)
                .setColor(result.results.length > 0 ? 0xf48024 : 0x666666)
                .setTimestamp();

            if (result.results.length > 0) {
                const pasteList = result.results
                    .slice(0, 5)
                    .map((p, i) => {
                        const snippet = p.snippet.slice(0, 80);
                        return `**${i + 1}.** [${p.title || 'Untitled'}](${p.url}) (${p.site})\n${snippet}...`;
                    })
                    .join('\n\n');

                mainEmbed.addFields({
                    name: '📄 Top Results',
                    value: pasteList || 'No pastes found',
                    inline: false,
                });

                if (result.results.length > 5) {
                    mainEmbed.addFields({
                        name: '➕ More',
                        value: `${result.results.length - 5} additional pastes found`,
                        inline: true,
                    });
                }
            }

            embeds.push(mainEmbed);

            // Extracted data embed
            const hasData =
                result.extractedData.emails.length > 0 ||
                result.extractedData.passwords.length > 0 ||
                result.extractedData.usernames.length > 0;

            if (hasData) {
                const dataEmbed = new EmbedBuilder()
                    .setTitle('⚠️ Extracted Sensitive Data')
                    .setColor(0xff0000)
                    .setDescription('**Warning:** This data was found in public paste dumps.');

                if (result.extractedData.emails.length > 0) {
                    dataEmbed.addFields({
                        name: '📧 Emails',
                        value: result.extractedData.emails.slice(0, 5).map(e => `\`${e}\``).join('\n'),
                        inline: true,
                    });
                }

                if (result.extractedData.passwords.length > 0) {
                    dataEmbed.addFields({
                        name: '🔓 Potential Passwords',
                        value: result.extractedData.passwords.slice(0, 3).map(p => `\`${p.slice(0, 3)}***\``).join('\n'),
                        inline: true,
                    });
                }

                if (result.extractedData.usernames.length > 0) {
                    dataEmbed.addFields({
                        name: '👤 Usernames',
                        value: result.extractedData.usernames.slice(0, 5).map(u => `\`${u}\``).join('\n'),
                        inline: true,
                    });
                }

                embeds.push(dataEmbed);
            }

            // Footer with timing
            embeds[embeds.length - 1].setFooter({
                text: `⏱️ ${result.executionTimeMs}ms${result.errors.length > 0 ? ` · ⚠️ ${result.errors[0]}` : ''}`,
            });

            await interaction.editReply({ content: null, embeds });
        } catch (error) {
            await interaction.editReply({
                content: `❌ Paste search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            });
        }
    },
};

export default command;
