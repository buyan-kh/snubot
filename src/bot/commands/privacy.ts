/**
 * /privacy command - Legal disclaimer and privacy policy
 */

import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../types.js';

const command: Command = {
    data: new SlashCommandBuilder()
        .setName('privacy')
        .setDescription('View privacy policy and legal disclaimer') as SlashCommandBuilder,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const embed = new EmbedBuilder()
            .setTitle('🔒 Privacy Policy & Legal Disclaimer')
            .setColor(0x5865f2)
            .setDescription(
                'This bot is designed for **security awareness** and legitimate OSINT research. ' +
                'It aggregates **publicly available information** to help users understand their digital footprint.'
            )
            .addFields(
                {
                    name: '✅ What We Do',
                    value: [
                        '• Query public APIs and websites',
                        '• Check public breach databases (names only)',
                        '• Aggregate publicly visible social media profiles',
                        '• Generate search queries for further research',
                    ].join('\n'),
                    inline: false,
                },
                {
                    name: '❌ What We Don\'t Do',
                    value: [
                        '• Access private or protected data',
                        '• Store or log credentials/passwords',
                        '• Sell or share collected information',
                        '• Bypass any security measures',
                    ].join('\n'),
                    inline: false,
                },
                {
                    name: '⚖️ Legal Notice',
                    value:
                        'Users are responsible for using this tool ethically and in compliance with applicable laws. ' +
                        'This tool is intended for security research, personal digital hygiene, and authorized penetration testing only.',
                    inline: false,
                },
                {
                    name: '🗑️ Data Handling',
                    value: [
                        '• Results are cached for 1 hour to reduce API load',
                        '• No personal data is permanently stored',
                        '• Logs are anonymized and rotated regularly',
                    ].join('\n'),
                    inline: false,
                },
                {
                    name: '📧 Opt-Out',
                    value:
                        'If you want your data removed from public breach databases, contact the original source (e.g., HaveIBeenPwned.com). ' +
                        'We do not control or store this data.',
                    inline: false,
                }
            )
            .setFooter({
                text: 'Use responsibly. Not for harassment, doxxing, or illegal purposes.',
            })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};

export default command;
