/**
 * /email command - Email OSINT lookup
 */

import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { lookupEmail, formatBreachSummary } from '../../modules/index.js';
import type { Command } from '../types.js';

const command: Command = {
    data: new SlashCommandBuilder()
        .setName('email')
        .setDescription('Check email for breaches and online presence')
        .addStringOption((option) =>
            option.setName('address').setDescription('Email address to lookup').setRequired(true)
        ) as SlashCommandBuilder,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const email = interaction.options.getString('address', true).trim().toLowerCase();

        // Basic email validation
        if (!email.includes('@') || !email.includes('.')) {
            await interaction.reply({
                content: '❌ Please provide a valid email address.',
                ephemeral: true,
            });
            return;
        }

        await interaction.deferReply();

        try {
            const result = await lookupEmail(email);

            // Main embed
            const embed = new EmbedBuilder()
                .setTitle('📧 Email OSINT Report')
                .setDescription(`Analysis for \`${email}\``)
                .setColor(result.breachCount > 0 ? 0xff6b6b : 0x00c853)
                .setTimestamp();

            // Domain info
            embed.addFields({
                name: '🌐 Domain',
                value: result.domain,
                inline: true,
            });

            // Gravatar
            if (result.gravatarExists && result.gravatarUrl) {
                embed.setThumbnail(result.gravatarUrl);
                embed.addFields({
                    name: '👤 Gravatar',
                    value: '✅ Profile exists',
                    inline: true,
                });
            } else {
                embed.addFields({
                    name: '👤 Gravatar',
                    value: '❌ No profile',
                    inline: true,
                });
            }

            // Breach status
            embed.addFields({
                name: '🔓 Breach Status',
                value: formatBreachSummary(result.breaches),
                inline: false,
            });

            // Data classes exposed (if breaches)
            if (result.breaches.length > 0) {
                const allClasses = new Set<string>();
                for (const breach of result.breaches) {
                    for (const cls of breach.dataClasses) {
                        allClasses.add(cls);
                    }
                }

                const topClasses = Array.from(allClasses).slice(0, 10);
                embed.addFields({
                    name: '📋 Data Types Exposed',
                    value: topClasses.map((c) => `\`${c}\``).join(', ') || 'Unknown',
                    inline: false,
                });
            }

            // Errors
            if (result.errors.length > 0) {
                embed.setFooter({ text: `⚠️ ${result.errors.join(', ')}` });
            }

            // Search suggestions embed
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
                content: `❌ Failed to lookup ${email}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            });
        }
    },
};

export default command;
