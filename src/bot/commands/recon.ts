/**
 * /recon - Master reconnaissance command
 * One username → searches everywhere
 */

import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { masterRecon } from '../../modules/master-recon.js';
import { logger } from '../../lib/index.js';
import type { Command } from '../types.js';

const command: Command = {
    data: new SlashCommandBuilder()
        .setName('recon')
        .setDescription('Full reconnaissance - searches X, GitHub, pastes, Reddit, and cross-platform')
        .addStringOption((option) =>
            option
                .setName('username')
                .setDescription('Username to investigate (X/Twitter handle works best)')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50)
        ) as SlashCommandBuilder,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        let username = interaction.options.getString('username', true).trim();

        // Fix common user error: accidentally pasting the full command
        if (username.startsWith('/recon ')) {
            username = username.replace('/recon ', '').trim();
        }

        // Basic sanitization
        username = username.split(' ')[0]; // Take only the first word if there are spaces

        await interaction.deferReply();

        try {
            logger.info(`Master recon: ${username}`);
            const result = await masterRecon(username);

            const embeds: EmbedBuilder[] = [];

            // Summary embed
            const summaryEmbed = new EmbedBuilder()
                .setTitle(`🔍 Full Recon: ${result.username}`)
                .setColor(0xff6b35)
                .setDescription(
                    `Searched X/Twitter, GitHub, paste sites, Reddit, and 30+ platforms.\n` +
                    `⏱️ Completed in ${(result.executionTimeMs / 1000).toFixed(1)}s`
                );

            // Quick stats
            const stats = [
                result.x.found ? '✅ X/Twitter' : '❌ X/Twitter',
                result.github.found ? `✅ GitHub (${result.github.codeCount} results)` : '❌ GitHub',
                result.pastes.found ? `✅ Pastes (${result.pastes.count} found)` : '❌ Pastes',
                result.reddit.found ? '✅ Reddit' : '❌ Reddit',
                `📱 ${result.platforms.total} platforms found`,
            ];

            summaryEmbed.addFields({
                name: '📊 Sources Checked',
                value: stats.join('\n'),
                inline: false,
            });

            // Extracted intel
            if (result.aggregated.allEmails.length > 0) {
                summaryEmbed.addFields({
                    name: '📧 Extracted Emails',
                    value: result.aggregated.allEmails.slice(0, 10).map(e => `\`${e}\``).join('\n'),
                    inline: true,
                });
            }

            // Deep Crawl Raw Findings (No Trust/Risk Analysis)
            if (result.deepCrawl) {
                const findingsEmbed = new EmbedBuilder()
                    .setTitle('🕵️ Deep Dive Findings')
                    .setColor(0x2b2d31) // Neutral dark grey
                    .setDescription(`Analyzed ${result.deepCrawl.pagesAnalyzed} pages from Google Search & external links.`);

                // 1. Detected Wallets (Show all unique up to 10)
                if (result.aggregated.allWallets && result.aggregated.allWallets.length > 0) {
                    const uniqueWallets = [...new Set(result.aggregated.allWallets)];
                    const walletList = uniqueWallets.slice(0, 10).map(w => `\`${w}\``).join('\n');

                    findingsEmbed.addFields({
                        name: `💰 Detected Wallets (${uniqueWallets.length})`,
                        value: walletList,
                        inline: false,
                    });
                } else {
                    findingsEmbed.addFields({
                        name: '💰 Detected Wallets',
                        value: 'None found',
                        inline: false,
                    });
                }

                // 2. Red Flags / Scam Keywords
                if (result.redFlags.length > 0) {
                    findingsEmbed.addFields({
                        name: '🚩 Potential Risk Indicators',
                        value: result.redFlags.map(f => `• ${f}`).join('\n'),
                        inline: false,
                    });
                }

                // 3. Suspicious Mentions with Context (Expanded)
                const significantMentions = result.deepCrawl.scamMentions;
                if (significantMentions.length > 0) {
                    // Group by keyword to avoid repetition
                    const mentionsText = significantMentions
                        .slice(0, 5) // Show top 5
                        .map(m => `**${m.keyword}**: "...${m.context.slice(0, 80)}..."\n🔗 [Link](${m.url})`)
                        .join('\n\n');

                    findingsEmbed.addFields({
                        name: '🔎 Contextual Matches',
                        value: mentionsText,
                        inline: false,
                    });
                }

                // 4. Crawled Pages Summary
                if (result.deepCrawl.crawledPages.length > 0) {
                    const topPages = result.deepCrawl.crawledPages
                        .slice(0, 5)
                        .map(p => `• [${p.title || 'Untitled'}](${p.url})`)
                        .join('\n');

                    findingsEmbed.addFields({
                        name: '🌐 Top Sources Analyzed',
                        value: topPages,
                        inline: false,
                    });
                }

                embeds.push(findingsEmbed);
            }

            if (result.aggregated.allUsernames.length > 1) {
                summaryEmbed.addFields({
                    name: '👤 Related Usernames',
                    value: result.aggregated.allUsernames.slice(0, 10).map(u => `\`${u}\``).join(', '),
                    inline: true,
                });
            }

            embeds.push(summaryEmbed);

            // X/Twitter embed
            if (result.x.found) {
                const xEmbed = new EmbedBuilder()
                    .setTitle('🐦 X/Twitter Profile')
                    .setColor(0x1da1f2)
                    .setURL(result.x.profileUrl);

                if (result.x.displayName) {
                    xEmbed.addFields({ name: 'Name', value: result.x.displayName, inline: true });
                }
                if (result.x.followers) {
                    xEmbed.addFields({ name: 'Followers', value: result.x.followers.toLocaleString(), inline: true });
                }
                if (result.x.bio) {
                    xEmbed.addFields({ name: 'Bio', value: result.x.bio.slice(0, 200), inline: false });
                }
                if (result.x.website) {
                    xEmbed.addFields({ name: 'Website', value: result.x.website, inline: false });
                }

                // Search URLs
                const searchLinks = Object.entries(result.x.searchUrls)
                    .slice(0, 4)
                    .map(([key, url]) => `[${key}](${url})`)
                    .join(' • ');
                xEmbed.addFields({ name: '🔍 Advanced Search', value: searchLinks, inline: false });

                embeds.push(xEmbed);
            }

            // Website Crawl embed (if X profile had a linked website)
            if (result.websiteCrawl && (
                result.websiteCrawl.emails.length > 0 ||
                result.websiteCrawl.socialLinks.length > 0 ||
                result.websiteCrawl.phoneNumbers.length > 0
            )) {
                const webEmbed = new EmbedBuilder()
                    .setTitle('🌐 Website Intel')
                    .setColor(0x00d084)
                    .setURL(result.websiteCrawl.url)
                    .setDescription(`Crawled: ${result.websiteCrawl.title || result.websiteCrawl.url}`);

                if (result.websiteCrawl.emails.length > 0) {
                    webEmbed.addFields({
                        name: '📧 Emails Found',
                        value: result.websiteCrawl.emails.slice(0, 5).map(e => `\`${e}\``).join('\n'),
                        inline: true,
                    });
                }

                if (result.websiteCrawl.phoneNumbers.length > 0) {
                    webEmbed.addFields({
                        name: '📞 Phone Numbers',
                        value: result.websiteCrawl.phoneNumbers.slice(0, 3).map(p => `\`${p}\``).join('\n'),
                        inline: true,
                    });
                }

                if (result.websiteCrawl.socialLinks.length > 0) {
                    const socialLinks = result.websiteCrawl.socialLinks
                        .slice(0, 8)
                        .map(s => `[${s.platform}${s.username ? `: ${s.username}` : ''}](${s.url})`)
                        .join('\n');
                    webEmbed.addFields({
                        name: '🔗 Social Links Discovered',
                        value: socialLinks,
                        inline: false,
                    });
                }

                embeds.push(webEmbed);
            }

            // GitHub embed
            if (result.github.found) {
                const ghEmbed = new EmbedBuilder()
                    .setTitle('📁 GitHub Results')
                    .setColor(0x24292f);

                ghEmbed.addFields({
                    name: 'Found',
                    value: `${result.github.codeCount} code results`,
                    inline: true,
                });

                if (result.github.extractedEmails.length > 0) {
                    ghEmbed.addFields({
                        name: 'Emails in Code',
                        value: result.github.extractedEmails.slice(0, 5).map(e => `\`${e}\``).join('\n'),
                        inline: true,
                    });
                }

                if (result.github.relatedUsers.length > 0) {
                    ghEmbed.addFields({
                        name: 'Related Users',
                        value: result.github.relatedUsers.slice(0, 5).map(u => `[\`${u}\`](https://github.com/${u})`).join(' '),
                        inline: false,
                    });
                }

                embeds.push(ghEmbed);
            }

            // Pastes embed
            if (result.pastes.found) {
                const pasteEmbed = new EmbedBuilder()
                    .setTitle('📋 Paste Site Results')
                    .setColor(0xf69220)
                    .addFields({
                        name: 'Found',
                        value: `${result.pastes.count} pastes on: ${result.pastes.sites.join(', ') || 'various sites'}`,
                        inline: false,
                    });

                if (result.pastes.extractedEmails.length > 0) {
                    pasteEmbed.addFields({
                        name: '⚠️ Leaked Emails',
                        value: result.pastes.extractedEmails.slice(0, 5).map(e => `\`${e}\``).join('\n'),
                        inline: true,
                    });
                }

                embeds.push(pasteEmbed);
            }

            // Reddit embed
            if (result.reddit.found) {
                const redditEmbed = new EmbedBuilder()
                    .setTitle('🔴 Reddit Profile')
                    .setColor(0xff4500)
                    .setURL(`https://reddit.com/u/${result.username}`);

                if (result.reddit.karma) {
                    redditEmbed.addFields({ name: 'Karma', value: result.reddit.karma.toLocaleString(), inline: true });
                }

                if (result.reddit.topSubreddits.length > 0) {
                    redditEmbed.addFields({
                        name: 'Active In',
                        value: result.reddit.topSubreddits.slice(0, 5).map(s => `r/${s}`).join(', '),
                        inline: true,
                    });
                }

                if (result.reddit.crossPlatformLinks.length > 0) {
                    redditEmbed.addFields({
                        name: '🔗 Cross-Platform Links',
                        value: result.reddit.crossPlatformLinks.slice(0, 5).join('\n'),
                        inline: false,
                    });
                }

                embeds.push(redditEmbed);
            }

            // Platforms embed
            if (result.platforms.total > 0) {
                const platformEmbed = new EmbedBuilder()
                    .setTitle('📱 Cross-Platform Presence')
                    .setColor(0x7289da)
                    .setDescription(
                        result.platforms.found.slice(0, 20).join(' • ') || 'No platforms found'
                    );

                embeds.push(platformEmbed);
            }

            await interaction.editReply({ embeds: embeds.slice(0, 10) });

        } catch (error) {
            logger.error('Recon command error:', error);
            await interaction.editReply({
                content: '❌ Recon failed. Please try again later.',
            });
        }
    },
};

export default command;
