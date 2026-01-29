/**
 * /deeprecon command - Deep X/Twitter reconnaissance
 */

import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { deepRecon } from '../../modules/deep-recon.js';
import type { Command } from '../types.js';

const command: Command = {
    data: new SlashCommandBuilder()
        .setName('deeprecon')
        .setDescription('Deep reconnaissance on X/Twitter profile - scrapes tweets, follows links, extracts PII')
        .addStringOption((option) =>
            option
                .setName('username')
                .setDescription('X/Twitter username to investigate')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50)
        )
        .addIntegerOption((option) =>
            option
                .setName('tweets')
                .setDescription('Number of tweets to analyze (default: 30)')
                .setRequired(false)
                .setMinValue(5)
                .setMaxValue(100)
        )
        .addBooleanOption((option) =>
            option
                .setName('crawl_links')
                .setDescription('Crawl external links for more intel (default: true)')
                .setRequired(false)
        ) as SlashCommandBuilder,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const username = interaction.options.getString('username', true).replace('@', '').trim();
        const maxTweets = interaction.options.getInteger('tweets') ?? 30;
        const crawlLinks = interaction.options.getBoolean('crawl_links') ?? true;

        // This takes a while - defer immediately
        await interaction.deferReply();

        try {
            await interaction.editReply({
                content: `🔍 **Deep recon started for @${username}**\n⏳ Scraping tweets, following links, extracting PII... This may take 1-2 minutes.`,
            });

            const result = await deepRecon(username, {
                maxTweets,
                crawlLinks,
                maxCrawlLinks: 5,
            });

            // Create main profile embed
            const profileEmbed = new EmbedBuilder()
                .setTitle(`🕵️ Deep Recon: @${result.username}`)
                .setURL(`https://x.com/${result.username}`)
                .setColor(0x9c27b0)
                .setTimestamp();

            if (result.profile.displayName) {
                profileEmbed.setDescription(
                    `**${result.profile.displayName}**\n${result.profile.bio || '_No bio_'}`
                );
            }

            const profileFields: Array<{ name: string; value: string; inline: boolean }> = [];

            if (result.profile.location) {
                profileFields.push({ name: '📍 Location', value: result.profile.location, inline: true });
            }
            if (result.profile.website) {
                profileFields.push({ name: '🔗 Website', value: result.profile.website, inline: true });
            }
            if (result.profile.joinedDate) {
                profileFields.push({ name: '📅 Joined', value: result.profile.joinedDate, inline: true });
            }

            profileFields.push({
                name: '📊 Analysis',
                value: `${result.tweets.length} tweets analyzed\n${result.crawledPages.length} pages crawled\n${(result.executionTimeMs / 1000).toFixed(1)}s total`,
                inline: true,
            });

            profileEmbed.addFields(profileFields);

            // Create PII embed
            const piiEmbed = new EmbedBuilder()
                .setTitle('🎯 Extracted Intelligence')
                .setColor(0xff5722);

            const piiFields: Array<{ name: string; value: string; inline: boolean }> = [];

            // Emails
            if (result.aggregatedPII.emails.length > 0) {
                piiFields.push({
                    name: '📧 Emails Found',
                    value: result.aggregatedPII.emails.slice(0, 5).map(e => `\`${e}\``).join('\n'),
                    inline: true,
                });
            }

            // Phones
            if (result.aggregatedPII.phones.length > 0) {
                piiFields.push({
                    name: '📱 Phone Numbers',
                    value: result.aggregatedPII.phones.slice(0, 3).map(p => `\`${p}\``).join('\n'),
                    inline: true,
                });
            }

            // Names
            if (result.aggregatedPII.potentialNames.length > 0) {
                piiFields.push({
                    name: '👤 Potential Names',
                    value: result.aggregatedPII.potentialNames.slice(0, 5).join(', '),
                    inline: false,
                });
            }

            // Other platforms
            const platforms: string[] = [];
            if (result.aggregatedPII.githubProfiles.length > 0) {
                platforms.push(`**GitHub:** ${result.aggregatedPII.githubProfiles.slice(0, 3).join(', ')}`);
            }
            if (result.aggregatedPII.linkedinProfiles.length > 0) {
                platforms.push(`**LinkedIn:** ${result.aggregatedPII.linkedinProfiles.slice(0, 3).join(', ')}`);
            }
            if (result.aggregatedPII.discordHandles.length > 0) {
                platforms.push(`**Discord:** ${result.aggregatedPII.discordHandles.slice(0, 3).join(', ')}`);
            }
            if (result.aggregatedPII.telegramHandles.length > 0) {
                platforms.push(`**Telegram:** ${result.aggregatedPII.telegramHandles.slice(0, 3).join(', ')}`);
            }
            if (result.aggregatedPII.instagramHandles.length > 0) {
                platforms.push(`**Instagram:** ${result.aggregatedPII.instagramHandles.slice(0, 3).join(', ')}`);
            }

            if (platforms.length > 0) {
                piiFields.push({
                    name: '🌐 Other Platforms',
                    value: platforms.join('\n'),
                    inline: false,
                });
            }

            if (piiFields.length === 0) {
                piiFields.push({
                    name: '📋 Result',
                    value: 'No PII extracted from profile, tweets, or crawled pages.',
                    inline: false,
                });
            }

            piiEmbed.addFields(piiFields);

            // Create connections embed
            const connectionsEmbed = new EmbedBuilder()
                .setTitle('🔗 Connection Graph')
                .setColor(0x2196f3);

            // Top mentions (people they interact with most)
            const topMentions = [...result.connectionGraph.mentions.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8);

            if (topMentions.length > 0) {
                connectionsEmbed.addFields({
                    name: '👥 Frequent Contacts',
                    value: topMentions.map(([m, c]) => `[@${m}](https://x.com/${m}) (${c})`).join('\n'),
                    inline: true,
                });
            }

            // Top domains
            const topDomains = [...result.connectionGraph.domains.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);

            if (topDomains.length > 0) {
                connectionsEmbed.addFields({
                    name: '🌍 Linked Domains',
                    value: topDomains.map(([d, c]) => `${d} (${c})`).join('\n'),
                    inline: true,
                });
            }

            // X mentions for follow-up recon
            if (result.aggregatedPII.xMentions.length > 0) {
                const uniqueMentions = result.aggregatedPII.xMentions.slice(0, 10);
                connectionsEmbed.addFields({
                    name: '🔎 Accounts to Investigate',
                    value: uniqueMentions.map(m => `@${m}`).join(', '),
                    inline: false,
                });
            }

            // Errors
            if (result.errors.length > 0) {
                connectionsEmbed.setFooter({ text: `⚠️ ${result.errors.slice(0, 2).join(', ')}` });
            }

            await interaction.editReply({
                content: null,
                embeds: [profileEmbed, piiEmbed, connectionsEmbed],
            });

        } catch (error) {
            await interaction.editReply({
                content: `❌ Deep recon failed for @${username}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            });
        }
    },
};

export default command;
