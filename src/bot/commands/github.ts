/**
 * /github command - GitHub OSINT search
 */

import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { searchGitHub } from '../../modules/github-osint.js';
import type { Command } from '../types.js';

const command: Command = {
    data: new SlashCommandBuilder()
        .setName('github')
        .setDescription('Search GitHub for usernames, emails, or code')
        .addStringOption((option) =>
            option
                .setName('query')
                .setDescription('Username, email, or search term')
                .setRequired(true)
                .setMinLength(2)
                .setMaxLength(100)
        ) as SlashCommandBuilder,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const query = interaction.options.getString('query', true).trim();

        await interaction.deferReply();

        try {
            const result = await searchGitHub(query);

            // Profile embed (if found)
            const embeds: EmbedBuilder[] = [];

            if (result.userProfile) {
                const profileEmbed = new EmbedBuilder()
                    .setTitle(`👤 ${result.userProfile.displayName || result.userProfile.username}`)
                    .setURL(`https://github.com/${result.userProfile.username}`)
                    .setColor(0x24292e)
                    .setThumbnail(result.userProfile.avatarUrl || null);

                const fields: Array<{ name: string; value: string; inline: boolean }> = [];

                if (result.userProfile.bio) {
                    profileEmbed.setDescription(result.userProfile.bio);
                }

                if (result.userProfile.location) {
                    fields.push({ name: '📍 Location', value: result.userProfile.location, inline: true });
                }
                if (result.userProfile.company) {
                    fields.push({ name: '🏢 Company', value: result.userProfile.company, inline: true });
                }
                if (result.userProfile.email) {
                    fields.push({ name: '📧 Email', value: `\`${result.userProfile.email}\``, inline: true });
                }
                if (result.userProfile.website) {
                    fields.push({ name: '🔗 Website', value: result.userProfile.website, inline: true });
                }

                fields.push({
                    name: '📊 Stats',
                    value: `${result.userProfile.followers} followers · ${result.userProfile.following} following`,
                    inline: false,
                });

                if (result.userProfile.pinnedRepos.length > 0) {
                    fields.push({
                        name: '📌 Pinned Repos',
                        value: result.userProfile.pinnedRepos.slice(0, 5).join(', '),
                        inline: false,
                    });
                }

                profileEmbed.addFields(fields);
                embeds.push(profileEmbed);
            }

            // Code search results
            if (result.codeResults.length > 0) {
                const codeEmbed = new EmbedBuilder()
                    .setTitle('💻 Code Search Results')
                    .setColor(0x0366d6);

                const codeList = result.codeResults
                    .slice(0, 5)
                    .map((r, i) => {
                        const snippet = r.matchedLine.slice(0, 100);
                        return `**${i + 1}.** [${r.repository}](${r.url})\n\`${snippet}...\``;
                    })
                    .join('\n\n');

                codeEmbed.setDescription(codeList || 'No code results');

                if (result.codeResults.length > 5) {
                    codeEmbed.setFooter({ text: `+${result.codeResults.length - 5} more results` });
                }

                embeds.push(codeEmbed);
            }

            // Extracted data
            if (result.extractedEmails.length > 0 || result.relatedUsers.length > 0) {
                const dataEmbed = new EmbedBuilder()
                    .setTitle('🎯 Extracted Intel')
                    .setColor(0x28a745);

                if (result.extractedEmails.length > 0) {
                    dataEmbed.addFields({
                        name: '📧 Emails Found',
                        value: result.extractedEmails.slice(0, 5).map(e => `\`${e}\``).join('\n'),
                        inline: true,
                    });
                }

                if (result.relatedUsers.length > 0) {
                    dataEmbed.addFields({
                        name: '👥 Related Users',
                        value: result.relatedUsers.slice(0, 5).map(u => `[${u}](https://github.com/${u})`).join('\n'),
                        inline: true,
                    });
                }

                embeds.push(dataEmbed);
            }

            if (embeds.length === 0) {
                await interaction.editReply({ content: `❌ No results found for "${query}"` });
                return;
            }

            // Add timing
            embeds[embeds.length - 1].setFooter({
                text: `⏱️ ${result.executionTimeMs}ms${result.errors.length > 0 ? ` · ⚠️ ${result.errors[0]}` : ''}`,
            });

            await interaction.editReply({ embeds });
        } catch (error) {
            await interaction.editReply({
                content: `❌ GitHub search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            });
        }
    },
};

export default command;
