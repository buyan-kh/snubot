/**
 * /reddit command - Reddit OSINT search
 */

import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { scrapeRedditUser } from '../../modules/reddit-osint.js';
import type { Command } from '../types.js';

const command: Command = {
    data: new SlashCommandBuilder()
        .setName('reddit')
        .setDescription('Scrape Reddit user profile and post history')
        .addStringOption((option) =>
            option
                .setName('username')
                .setDescription('Reddit username (without u/)')
                .setRequired(true)
                .setMinLength(3)
                .setMaxLength(50)
        )
        .addIntegerOption((option) =>
            option
                .setName('posts')
                .setDescription('Number of posts to analyze (default: 30)')
                .setRequired(false)
                .setMinValue(5)
                .setMaxValue(100)
        ) as SlashCommandBuilder,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const username = interaction.options.getString('username', true).replace(/^u\//, '').trim();
        const maxPosts = interaction.options.getInteger('posts') ?? 30;

        await interaction.deferReply();

        try {
            const result = await scrapeRedditUser(username, {
                getProfile: true,
                scrapeHistory: true,
                maxPosts,
            });

            if (result.errors.includes('User not found or profile is private')) {
                await interaction.editReply({ content: `❌ Reddit user u/${username} not found or is private.` });
                return;
            }

            const embeds: EmbedBuilder[] = [];

            // Profile embed
            if (result.profile) {
                const profileEmbed = new EmbedBuilder()
                    .setTitle(`👤 u/${result.profile.username}`)
                    .setURL(`https://reddit.com/user/${result.profile.username}`)
                    .setColor(0xff4500)
                    .setThumbnail(result.profile.avatarUrl || null);

                if (result.profile.bio) {
                    profileEmbed.setDescription(result.profile.bio);
                }

                const fields: Array<{ name: string; value: string; inline: boolean }> = [];

                fields.push({
                    name: '⬆️ Karma',
                    value: result.profile.karma.total.toLocaleString(),
                    inline: true,
                });

                if (result.profile.accountAge) {
                    fields.push({
                        name: '📅 Account Age',
                        value: result.profile.accountAge,
                        inline: true,
                    });
                }

                if (result.profile.isNsfw) {
                    fields.push({
                        name: '🔞 NSFW',
                        value: 'Profile is marked NSFW',
                        inline: true,
                    });
                }

                profileEmbed.addFields(fields);
                embeds.push(profileEmbed);
            }

            // Activity embed
            if (result.recentPosts.length > 0) {
                const activityEmbed = new EmbedBuilder()
                    .setTitle('📊 Activity Analysis')
                    .setColor(0xff4500);

                // Top subreddits
                const topSubs = [...result.subreddits.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 8);

                if (topSubs.length > 0) {
                    activityEmbed.addFields({
                        name: '🏠 Top Subreddits',
                        value: topSubs.map(([sub, count]) => `r/${sub} (${count})`).join('\n'),
                        inline: true,
                    });
                }

                // Recent activity
                const recentPosts = result.recentPosts.slice(0, 3);
                if (recentPosts.length > 0) {
                    const postList = recentPosts.map(p =>
                        `• [${p.title.slice(0, 40)}...](${p.url}) in r/${p.subreddit}`
                    ).join('\n');

                    activityEmbed.addFields({
                        name: '📝 Recent Posts',
                        value: postList,
                        inline: false,
                    });
                }

                embeds.push(activityEmbed);
            }

            // Cross-references embed
            if (result.crossReferences.length > 0 || result.extractedPII.emails.length > 0) {
                const crossRefEmbed = new EmbedBuilder()
                    .setTitle('🔗 Cross-Platform Intel')
                    .setColor(0x00d4aa);

                if (result.crossReferences.length > 0) {
                    const refList = result.crossReferences
                        .slice(0, 6)
                        .map(r => `**${r.platform}:** [${r.username}](${r.url})`)
                        .join('\n');

                    crossRefEmbed.addFields({
                        name: '🌐 Linked Accounts',
                        value: refList,
                        inline: false,
                    });
                }

                if (result.extractedPII.emails.length > 0) {
                    crossRefEmbed.addFields({
                        name: '📧 Emails Found',
                        value: result.extractedPII.emails.slice(0, 3).map(e => `\`${e}\``).join('\n'),
                        inline: true,
                    });
                }

                if (result.extractedPII.mentionedUsernames.length > 0) {
                    crossRefEmbed.addFields({
                        name: '👥 Mentioned Users',
                        value: result.extractedPII.mentionedUsernames.slice(0, 5).map(u => `u/${u}`).join(', '),
                        inline: true,
                    });
                }

                embeds.push(crossRefEmbed);
            }

            // Interests (from subreddits)
            if (result.extractedPII.interests.length > 0) {
                embeds[embeds.length - 1].addFields({
                    name: '💡 Inferred Interests',
                    value: result.extractedPII.interests.slice(0, 8).join(', '),
                    inline: false,
                });
            }

            // Footer
            embeds[embeds.length - 1].setFooter({
                text: `Analyzed ${result.recentPosts.length} posts · ⏱️ ${result.executionTimeMs}ms`,
            });

            await interaction.editReply({ embeds });
        } catch (error) {
            await interaction.editReply({
                content: `❌ Reddit scrape failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            });
        }
    },
};

export default command;
