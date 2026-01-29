/**
 * /username command - Cross-platform username search
 */

import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { lookupUsername, groupProfilesByCategory } from '../../modules/index.js';
import type { Command } from '../types.js';

const command: Command = {
    data: new SlashCommandBuilder()
        .setName('username')
        .setDescription('Search for a username across multiple platforms')
        .addStringOption((option) =>
            option
                .setName('handle')
                .setDescription('Username to search')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50)
        ) as SlashCommandBuilder,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const username = interaction.options.getString('handle', true).replace('@', '').trim();

        await interaction.deferReply();

        try {
            const result = await lookupUsername(username);

            // Main embed
            const embed = new EmbedBuilder()
                .setTitle(`🔍 Username Search: ${username}`)
                .setDescription(
                    `Found **${result.foundProfiles.length}** profiles across ${result.totalChecked} platforms\n` +
                    `⏱️ Completed in ${(result.executionTimeMs / 1000).toFixed(1)}s`
                )
                .setColor(result.foundProfiles.length > 0 ? 0x00c853 : 0xff9800)
                .setTimestamp();

            // Group by category
            const grouped = groupProfilesByCategory(result.foundProfiles);

            // Add fields for each category (limit to avoid embed size issues)
            let fieldCount = 0;
            for (const [category, profiles] of grouped) {
                if (fieldCount >= 10) break; // Discord embed limit

                const links = profiles
                    .slice(0, 5)
                    .map((p) => `[${p.platform}](${p.url})`)
                    .join(' · ');

                const extra = profiles.length > 5 ? ` +${profiles.length - 5} more` : '';

                embed.addFields({
                    name: `${getCategoryEmoji(category)} ${category}`,
                    value: `${links}${extra}`,
                    inline: false,
                });

                fieldCount++;
            }

            // If too many categories, note that
            if (grouped.size > 10) {
                embed.addFields({
                    name: '📋 More Results',
                    value: `${grouped.size - 10} additional categories found. Use API directly for full results.`,
                    inline: false,
                });
            }

            // Errors
            if (result.errors.length > 0) {
                embed.setFooter({ text: `⚠️ ${result.errors.join(', ')}` });
            }

            // Search suggestions
            const searchEmbed = new EmbedBuilder()
                .setTitle('💡 OSINT Search Suggestions')
                .setColor(0x666666)
                .setDescription(
                    result.suggestedSearches
                        .slice(0, 5)
                        .map((q, i) => `${i + 1}. \`${q}\``)
                        .join('\n')
                );

            await interaction.editReply({ embeds: [embed, searchEmbed] });
        } catch (error) {
            await interaction.editReply({
                content: `❌ Failed to search ${username}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            });
        }
    },
};

function getCategoryEmoji(category: string): string {
    const emojiMap: Record<string, string> = {
        Social: '💬',
        Development: '💻',
        Professional: '💼',
        Gaming: '🎮',
        Music: '🎵',
        Creator: '🎨',
        Security: '🔐',
        Design: '✏️',
        Photography: '📷',
        Tech: '🚀',
        Blogging: '📝',
        Messaging: '📱',
    };

    return emojiMap[category] || '🔗';
}

export default command;
