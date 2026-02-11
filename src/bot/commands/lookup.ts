import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../types.js';
import { parseUsername, scrapeTweets, scrapeLinks, braveSearchForPII, mergePII, extractPII } from '../../modules/index.js';
import type { LookupResult } from '../../types/index.js';

const lookupCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('lookup')
        .setDescription('Look up an X.com profile - scrapes tweets, follows links, extracts PII')
        .addStringOption(option =>
            option
                .setName('target')
                .setDescription('X/Twitter username, @handle, or profile URL')
                .setRequired(true)
        ) as SlashCommandBuilder,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const target = interaction.options.getString('target', true);
        const username = parseUsername(target);
        const startTime = Date.now();

        await interaction.deferReply();

        const result: LookupResult = {
            username,
            profileName: '',
            profileBio: '',
            profileLocation: '',
            tweets: [],
            scrapedPages: [],
            braveSearches: [],
            pii: { emails: [], phones: [], names: [] } as import('../../types/index.js').ExtractedPII,
            executionTimeMs: 0,
            errors: [],
        };

        try {
            // Stage 1: Scrape tweets
            await interaction.editReply(`Scraping tweets from @${username}...`);
            const scrapeResult = await scrapeTweets(username);
            result.tweets = scrapeResult.tweets;
            result.profileName = scrapeResult.profile.displayName;
            result.profileBio = scrapeResult.profile.bio;
            result.profileLocation = scrapeResult.profile.location;
            result.errors.push(...scrapeResult.errors);

            // Stage 2: Collect links from tweets + profile website + bio links
            const allLinks: string[] = [];
            if (scrapeResult.profile.website) {
                allLinks.push(scrapeResult.profile.website);
            }
            allLinks.push(...scrapeResult.profile.bioLinks);
            for (const tweet of result.tweets) {
                allLinks.push(...tweet.links);
            }
            const uniqueLinks = [...new Set(allLinks)];

            // Stage 3: Scrape external links
            if (uniqueLinks.length > 0) {
                await interaction.editReply(`Scraping ${uniqueLinks.length} linked pages...`);
                result.scrapedPages = await scrapeLinks(uniqueLinks);
            }

            // Stage 4: Extract PII from all sources
            await interaction.editReply('Extracting information...');
            const allPII = [scrapeResult.profilePII];

            for (const tweet of result.tweets) {
                allPII.push(extractPII(tweet.text, 'Tweet'));
            }

            for (const page of result.scrapedPages) {
                if (!page.error) {
                    allPII.push(page.pii);
                }
            }

            result.pii = mergePII(allPII);

            // Stage 5: Brave Search enrichment
            if (result.pii.emails.length > 0 || result.pii.names.length > 0) {
                await interaction.editReply('Enriching with Brave Search...');
                const braveResult = await braveSearchForPII(result.pii);
                result.braveSearches = braveResult.searches;

                // Merge Brave PII into main results
                result.pii = mergePII([result.pii, braveResult.extractedPII]);
            }

            result.executionTimeMs = Date.now() - startTime;

            // Build response embeds
            const embeds = buildEmbeds(result);
            await interaction.editReply({ content: null, embeds });

        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Lookup failed';
            result.errors.push(msg);
            result.executionTimeMs = Date.now() - startTime;

            await interaction.editReply(`Lookup failed: ${msg}`);
        }
    },
};

function buildEmbeds(result: LookupResult): EmbedBuilder[] {
    const embeds: EmbedBuilder[] = [];

    const main = new EmbedBuilder()
        .setTitle(`Lookup: @${result.username}`)
        .setColor(0x1da1f2);

    if (result.profileName) {
        main.addFields({ name: 'Name', value: result.profileName, inline: true });
    }
    if (result.profileBio) {
        main.addFields({ name: 'Bio', value: result.profileBio.slice(0, 1024), inline: false });
    }
    if (result.profileLocation) {
        main.addFields({ name: 'Location', value: result.profileLocation, inline: true });
    }

    main.addFields({
        name: 'Stats',
        value: [
            `Tweets scraped: ${result.tweets.length}`,
            `Pages scraped: ${result.scrapedPages.length}`,
            `Brave searches: ${result.braveSearches.length}`,
        ].join('\n'),
        inline: false,
    });

    embeds.push(main);

    // PII embed
    if (result.pii.phones.length > 0 || result.pii.emails.length > 0 || result.pii.names.length > 0) {
        const piiEmbed = new EmbedBuilder()
            .setTitle('Extracted Information')
            .setColor(0x00ff00);

        if (result.pii.phones.length > 0) {
            piiEmbed.addFields({
                name: `Phones (${result.pii.phones.length})`,
                value: result.pii.phones.slice(0, 10).map(p => `${p.value} — _${p.source}_`).join('\n'),
                inline: false,
            });
        }

        if (result.pii.emails.length > 0) {
            piiEmbed.addFields({
                name: `Emails (${result.pii.emails.length})`,
                value: result.pii.emails.slice(0, 10).map(e => `${e.value} — _${e.source}_`).join('\n'),
                inline: false,
            });
        }

        if (result.pii.names.length > 0) {
            piiEmbed.addFields({
                name: `Names (${result.pii.names.length})`,
                value: result.pii.names.slice(0, 10).map(n => `${n.value} — _${n.source}_`).join('\n'),
                inline: false,
            });
        }

        embeds.push(piiEmbed);
    }

    // Footer with timing
    const lastEmbed = embeds[embeds.length - 1];
    lastEmbed.setFooter({
        text: `Completed in ${(result.executionTimeMs / 1000).toFixed(1)}s${result.errors.length > 0 ? ` | ${result.errors.length} error(s)` : ''}`,
    });

    return embeds;
}

export default lookupCommand;
