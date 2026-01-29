/**
 * /discord - Discord handle OSINT command
 * Search GitHub and paste sites for Discord handle mentions
 */

import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { discordOsint } from '../../modules/discord-osint.js';
import { logger } from '../../lib/index.js';
import type { Command } from '../types.js';

const command: Command = {
    data: new SlashCommandBuilder()
        .setName('discord')
        .setDescription('Search for a Discord handle across GitHub and paste sites')
        .addStringOption((option) =>
            option
                .setName('handle')
                .setDescription('Discord username (e.g., username or username#1234)')
                .setRequired(true)
                .setMinLength(2)
                .setMaxLength(40)
        ) as SlashCommandBuilder,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const handle = interaction.options.getString('handle', true);

        await interaction.deferReply();

        try {
            logger.info(`Discord OSINT lookup: ${handle}`);
            const result = await discordOsint(handle);

            const embeds: EmbedBuilder[] = [];

            // Main summary embed
            const summaryEmbed = new EmbedBuilder()
                .setTitle(`🔍 Discord OSINT: ${handle}`)
                .setColor(0x5865f2) // Discord blurple
                .setDescription(
                    `Searched GitHub and paste sites for mentions of this Discord handle.\n` +
                    `⏱️ Completed in ${(result.executionTimeMs / 1000).toFixed(1)}s`
                );

            // Stats
            const totalGitHub = result.github.codeResults.length + result.github.commitResults.length;
            const totalPastes = result.pastes.results.length;
            const totalEmails = result.crossPlatform.possibleEmails.length;

            summaryEmbed.addFields({
                name: '📊 Results Summary',
                value: [
                    `**GitHub Mentions:** ${totalGitHub}`,
                    `**Paste Site Results:** ${totalPastes}`,
                    `**Extracted Emails:** ${totalEmails}`,
                    `**Related Users:** ${result.github.relatedUsers.length}`,
                ].join('\n'),
                inline: false,
            });

            if (result.errors.length > 0) {
                summaryEmbed.addFields({
                    name: '⚠️ Warnings',
                    value: result.errors.slice(0, 3).join('\n'),
                    inline: false,
                });
            }

            embeds.push(summaryEmbed);

            // GitHub results embed
            if (totalGitHub > 0) {
                const githubEmbed = new EmbedBuilder()
                    .setTitle('📁 GitHub Mentions')
                    .setColor(0x24292f);

                // Commit results
                if (result.github.commitResults.length > 0) {
                    const commitLines = result.github.commitResults
                        .slice(0, 5)
                        .map((r) => `• [${r.repo}](${r.url}) - ${r.snippet.slice(0, 50)}...`);

                    githubEmbed.addFields({
                        name: `📝 Commits (${result.github.commitResults.length})`,
                        value: commitLines.join('\n').slice(0, 1000) || 'None found',
                        inline: false,
                    });
                }

                // Code results
                if (result.github.codeResults.length > 0) {
                    const codeLines = result.github.codeResults
                        .slice(0, 5)
                        .map((r) => `• [${r.file}](${r.url}) (${r.context})`);

                    githubEmbed.addFields({
                        name: `💻 Code Files (${result.github.codeResults.length})`,
                        value: codeLines.join('\n').slice(0, 1000) || 'None found',
                        inline: false,
                    });
                }

                // Related GitHub users
                if (result.github.relatedUsers.length > 0) {
                    githubEmbed.addFields({
                        name: '👥 Related GitHub Users',
                        value: result.github.relatedUsers
                            .slice(0, 10)
                            .map((u) => `[\`${u}\`](https://github.com/${u})`)
                            .join(' • '),
                        inline: false,
                    });
                }

                embeds.push(githubEmbed);
            }

            // Paste results embed  
            if (result.pastes.results.length > 0) {
                const pasteEmbed = new EmbedBuilder()
                    .setTitle('📋 Paste Site Results')
                    .setColor(0xf69220);

                const pasteLines = result.pastes.results
                    .slice(0, 8)
                    .map((p) => `• [${p.title.slice(0, 40) || p.site}](${p.url})\n  └ ${p.snippet.slice(0, 80)}...`);

                pasteEmbed.setDescription(pasteLines.join('\n').slice(0, 2000));

                // Extracted data
                if (result.crossPlatform.possibleEmails.length > 0) {
                    pasteEmbed.addFields({
                        name: '📧 Extracted Emails',
                        value: result.crossPlatform.possibleEmails
                            .slice(0, 10)
                            .map((e) => `\`${e}\``)
                            .join('\n'),
                        inline: true,
                    });
                }

                if (result.crossPlatform.linkedAccounts.length > 0) {
                    pasteEmbed.addFields({
                        name: '🔗 Linked Accounts',
                        value: result.crossPlatform.linkedAccounts
                            .slice(0, 5)
                            .join('\n'),
                        inline: true,
                    });
                }

                embeds.push(pasteEmbed);
            }

            // Search URLs embed
            const searchEmbed = new EmbedBuilder()
                .setTitle('🔎 Manual Search Links')
                .setColor(0x4285f4)
                .setDescription(
                    result.searchUrls
                        .map((url) => `• [Search](${url})`)
                        .join('\n')
                )
                .setFooter({ text: '⚠️ Use responsibly - for authorized security research only' });

            embeds.push(searchEmbed);

            await interaction.editReply({ embeds: embeds.slice(0, 10) });

        } catch (error) {
            logger.error('Discord command error:', error);
            await interaction.editReply({
                content: '❌ Failed to search for Discord handle. Please try again later.',
            });
        }
    },
};

export default command;
