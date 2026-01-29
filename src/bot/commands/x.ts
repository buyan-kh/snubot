/**
 * /x command - X/Twitter profile lookup
 */

import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { lookupXProfile, generateXSearchUrls } from '../../modules/index.js';
import type { Command } from '../types.js';

const command: Command = {
    data: new SlashCommandBuilder()
        .setName('x')
        .setDescription('Lookup an X/Twitter profile')
        .addStringOption((option) =>
            option
                .setName('username')
                .setDescription('X/Twitter username (without @)')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50)
        ) as SlashCommandBuilder,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const username = interaction.options.getString('username', true).replace('@', '').trim();

        await interaction.deferReply();

        try {
            const result = await lookupXProfile(username);

            // Build embed
            const embed = new EmbedBuilder()
                .setTitle(`@${result.username}`)
                .setURL(`https://x.com/${result.username}`)
                .setColor(result.errors.length > 0 ? 0xff6b6b : 0x1da1f2)
                .setTimestamp();

            if (result.errors.length > 0 && !result.displayName) {
                // Account doesn't exist or error
                embed.setDescription(`❌ ${result.errors.join(', ')}`);
                await interaction.editReply({ embeds: [embed] });
                return;
            }

            // Profile info
            if (result.displayName) {
                embed.setAuthor({
                    name: result.displayName,
                    ...(result.profileImageUrl ? { iconURL: result.profileImageUrl } : {}),
                    url: `https://x.com/${result.username}`,
                });
            }

            if (result.profileImageUrl) {
                embed.setThumbnail(result.profileImageUrl);
            }

            if (result.bio) {
                embed.setDescription(result.bio);
            }

            // Fields
            const fields: Array<{ name: string; value: string; inline: boolean }> = [];

            if (result.location) {
                fields.push({ name: '📍 Location', value: result.location, inline: true });
            }

            if (result.website) {
                fields.push({ name: '🔗 Website', value: result.website, inline: true });
            }

            if (result.joinedDate) {
                fields.push({ name: '📅 Joined', value: result.joinedDate, inline: true });
            }

            // Stats
            fields.push({
                name: '📊 Stats',
                value: [
                    `**${formatNumber(result.followers)}** followers`,
                    `**${formatNumber(result.following)}** following`,
                    `**${formatNumber(result.tweetCount)}** posts`,
                ].join(' · '),
                inline: false,
            });

            // Verification badge
            if (result.verified) {
                fields.push({ name: '✓ Verified', value: 'Yes', inline: true });
            }

            embed.addFields(fields);

            // Advanced search links
            const searchUrls = generateXSearchUrls(result.username);
            const searchLinks = [
                `[Posts](${searchUrls.from})`,
                `[Mentions](${searchUrls.mentions})`,
                `[Media](${searchUrls.recentMedia})`,
            ].join(' | ');

            embed.addFields({
                name: '🔍 Advanced Search',
                value: searchLinks,
                inline: false,
            });

            // Footer with errors
            if (result.errors.length > 0) {
                embed.setFooter({ text: `⚠️ Partial data: ${result.errors.join(', ')}` });
            }

            // Suggested searches in second embed
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
                content: `❌ Failed to lookup @${username}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            });
        }
    },
};

function formatNumber(num: number): string {
    if (num >= 1000000) {
        return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
        return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
}

export default command;
