/**
 * /google command - Google dork search
 */

import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { searchGoogle } from '../../modules/index.js';
import type { Command } from '../types.js';

const command: Command = {
    data: new SlashCommandBuilder()
        .setName('google')
        .setDescription('Execute a Google search (supports OSINT dorks)')
        .addStringOption((option) =>
            option
                .setName('query')
                .setDescription('Search query or dork (e.g., "username" site:github.com)')
                .setRequired(true)
                .setMinLength(2)
                .setMaxLength(200)
        ) as SlashCommandBuilder,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const query = interaction.options.getString('query', true).trim();

        await interaction.deferReply();

        try {
            const result = await searchGoogle(query);

            // Main embed
            const embed = new EmbedBuilder()
                .setTitle('🔍 Google Search Results')
                .setDescription(`**Query:** \`${result.query}\``)
                .setColor(result.errors.length > 0 ? 0xff9800 : 0x4285f4)
                .setTimestamp();

            // Results count
            if (result.totalResults) {
                embed.addFields({
                    name: '📊 Total Results',
                    value: result.totalResults,
                    inline: true,
                });
            }

            embed.addFields({
                name: '⏱️ Search Time',
                value: `${result.executionTimeMs}ms`,
                inline: true,
            });

            embed.addFields({
                name: '📡 Source',
                value: result.source === 'serpapi' ? 'SerpAPI' : 'Web Scrape',
                inline: true,
            });

            // Top results
            if (result.results.length > 0) {
                const resultsList = result.results
                    .slice(0, 5)
                    .map((r, i) => {
                        const title = r.title.length > 50 ? r.title.slice(0, 47) + '...' : r.title;
                        const snippet = r.snippet.length > 80 ? r.snippet.slice(0, 77) + '...' : r.snippet;
                        return `**${i + 1}.** [${title}](${r.url})\n${snippet}`;
                    })
                    .join('\n\n');

                embed.addFields({
                    name: `📄 Top ${Math.min(5, result.results.length)} Results`,
                    value: resultsList || 'No results found',
                    inline: false,
                });

                if (result.results.length > 5) {
                    embed.addFields({
                        name: '➕ More Results',
                        value: `${result.results.length - 5} additional results available`,
                        inline: false,
                    });
                }
            } else {
                embed.addFields({
                    name: '📄 Results',
                    value: '❌ No results found',
                    inline: false,
                });
            }

            // Errors
            if (result.errors.length > 0) {
                embed.setFooter({ text: `⚠️ ${result.errors.join(', ')}` });
            }

            // Quick Google link
            embed.addFields({
                name: '🔗 Open in Google',
                value: `[View full results](https://www.google.com/search?q=${encodeURIComponent(query)})`,
                inline: false,
            });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            await interaction.editReply({
                content: `❌ Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            });
        }
    },
};

export default command;
