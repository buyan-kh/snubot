import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../types.js';
import { logger } from '../../lib/logger.js';
import { parseUsername, scrapeTweets, scrapeLinks, braveSearchForPII, mergePII, filterRelevantPII, pageMatchesTarget, extractPII, verifyPhones, deriveNameFromEmail, searchPeopleSites, parseLocation } from '../../modules/index.js';
import type { LookupResult } from '../../types/index.js';
import type { PhoneVerificationResult } from '../../modules/phone-verifier.js';

const lookupCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('lookup')
        .setDescription('Look up an X.com profile - finds phone numbers via scraping, search, and AI verification')
        .addStringOption(option =>
            option
                .setName('target')
                .setDescription('X/Twitter username, @handle, or profile URL')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('email')
                .setDescription('Known email address (improves search accuracy)')
                .setRequired(false)
        ) as SlashCommandBuilder,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const target = interaction.options.getString('target', true);
        const email = interaction.options.getString('email') ?? undefined;
        const username = parseUsername(target);
        const startTime = Date.now();

        await interaction.deferReply();

        const result: LookupResult = {
            username,
            ...(email ? { email } : {}),
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

            // Stage 3: Scrape external links (level 1)
            if (uniqueLinks.length > 0) {
                await interaction.editReply(`Scraping ${uniqueLinks.length} linked pages...`);
                result.scrapedPages = await scrapeLinks(uniqueLinks);
            }

            // Stage 3.5: Level-2 deep crawl — follow links found within level-1 pages
            const level1Urls = new Set(result.scrapedPages.map(p => p.url));
            const level2Candidates = result.scrapedPages
                .filter(p => !p.error)
                .flatMap(p => p.links)
                .filter(link => !level1Urls.has(link) && !uniqueLinks.includes(link));
            const level2Urls = [...new Set(level2Candidates)].slice(0, 15);

            if (level2Urls.length > 0) {
                await interaction.editReply(`Scraping ${level2Urls.length} deeper links...`);
                const level2Pages = await scrapeLinks(level2Urls);
                result.scrapedPages.push(...level2Pages);
            }

            // Stage 4: Extract PII from all sources (phones + emails only)
            await interaction.editReply('Extracting phone numbers...');
            const allPII = [scrapeResult.profilePII];

            for (const tweet of result.tweets) {
                allPII.push(extractPII(tweet.text, 'Tweet'));
            }

            const targetIdentity = { username, profileName: result.profileName };
            for (const page of result.scrapedPages) {
                if (!page.error) {
                    if (pageMatchesTarget(page.textContent, targetIdentity)) {
                        // Page mentions the target — include all PII
                        allPII.push(page.pii);
                    } else {
                        // Unrelated page — include phones/names but NOT emails
                        allPII.push({
                            emails: [],
                            phones: page.pii.phones,
                            names: page.pii.names,
                        });
                    }
                }
            }

            // Seed user-provided email into PII
            if (email) {
                allPII.push({
                    emails: [{ value: email.toLowerCase(), source: 'User input', count: 1 }],
                    phones: [],
                    names: [],
                });
            }

            result.pii = mergePII(allPII);

            // Stage 4.5: Derive name from email + people-search sites
            let derivedEmailName: string | undefined;
            const firstEmail = email || result.pii.emails[0]?.value;
            if (firstEmail) {
                const derived = deriveNameFromEmail(firstEmail);
                if (derived) {
                    derivedEmailName = derived.fullName;
                    logger.info(`Derived name from email: ${derived.fullName}`);

                    const parsedLoc = result.profileLocation ? parseLocation(result.profileLocation) : null;

                    await interaction.editReply('Searching people-search sites...');
                    const peopleResult = await searchPeopleSites({
                        firstName: derived.firstName,
                        lastName: derived.lastName,
                        email: firstEmail,
                        location: parsedLoc,
                    });

                    if (peopleResult.extractedPII.phones.length > 0 || peopleResult.extractedPII.emails.length > 0) {
                        result.pii = mergePII([result.pii, peopleResult.extractedPII]);
                    }
                }
            }

            // Stage 5: Brave Search (use username + email + profile name to find phone numbers)
            if (result.pii.emails.length > 0 || email) {
                await interaction.editReply('Searching for phone numbers...');
                const braveResult = await braveSearchForPII(result.pii, {
                    ...(email ? { email } : {}),
                    username,
                    ...(result.profileLocation ? { location: result.profileLocation } : {}),
                    ...(result.profileName ? { verifiedName: result.profileName } : {}),
                    ...(derivedEmailName ? { derivedEmailName } : {}),
                });
                result.braveSearches = braveResult.searches;

                // Merge Brave snippet PII into main results
                result.pii = mergePII([result.pii, braveResult.extractedPII]);

                // Stage 6: Scrape Brave result pages for deeper PII
                const braveUrls = braveResult.searches
                    .flatMap(s => s.results.map(r => r.url))
                    .filter(Boolean);

                if (braveUrls.length > 0) {
                    await interaction.editReply(`Scraping ${braveUrls.length} search result pages...`);
                    const bravePages = await scrapeLinks(braveUrls);
                    result.scrapedPages.push(...bravePages);

                    const bravePagePII = bravePages
                        .filter(p => !p.error)
                        .map(p => {
                            if (pageMatchesTarget(p.textContent, targetIdentity)) {
                                return p.pii;
                            }
                            // Unrelated page — phones only
                            return { emails: [], phones: p.pii.phones, names: p.pii.names } as import('../../types/index.js').ExtractedPII;
                        });
                    if (bravePagePII.length > 0) {
                        result.pii = mergePII([result.pii, ...bravePagePII]);
                    }
                }
            }

            // Stage 6.5: Filter PII to items relevant to the target
            result.pii = filterRelevantPII(result.pii, {
                username,
                profileName: result.profileName,
            });

            // Stage 7: Verify phone numbers with Gemini
            let phoneVerification: PhoneVerificationResult | null = null;
            if (result.pii.phones.length > 0) {
                await interaction.editReply('Verifying phone numbers with AI...');
                phoneVerification = await verifyPhones(result.pii.phones, {
                    username,
                    ...(email ? { email } : {}),
                    profileName: result.profileName,
                    profileBio: result.profileBio,
                    profileLocation: result.profileLocation,
                    emails: result.pii.emails,
                });
            }

            result.executionTimeMs = Date.now() - startTime;

            // Build response embeds
            const embeds = buildEmbeds(result, phoneVerification);
            await interaction.editReply({ content: null, embeds });

        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Lookup failed';
            result.errors.push(msg);
            result.executionTimeMs = Date.now() - startTime;

            await interaction.editReply(`Lookup failed: ${msg}`);
        }
    },
};

function buildEmbeds(result: LookupResult, phoneVerification?: PhoneVerificationResult | null): EmbedBuilder[] {
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

    // Phone results embed
    if (result.pii.phones.length > 0 || result.pii.emails.length > 0) {
        const piiEmbed = new EmbedBuilder()
            .setTitle('Results')
            .setColor(0x00ff00);

        if (result.pii.phones.length > 0) {
            // Show Gemini-verified phones if available
            if (phoneVerification?.verifiedPhones && phoneVerification.verifiedPhones.length > 0) {
                const high = phoneVerification.verifiedPhones.filter(v => v.confidence === 'high');
                const medium = phoneVerification.verifiedPhones.filter(v => v.confidence === 'medium');
                const low = phoneVerification.verifiedPhones.filter(v => v.confidence === 'low');
                const lines: string[] = [];

                for (const v of high) {
                    const match = result.pii.phones.find(p => p.value === v.number);
                    const source = match?.source ?? 'unknown';
                    lines.push(`[HIGH] ${v.number} — _${source}_\n  ${v.reasoning}`);
                }
                for (const v of medium) {
                    const match = result.pii.phones.find(p => p.value === v.number);
                    const source = match?.source ?? 'unknown';
                    lines.push(`[MED] ${v.number} — _${source}_\n  ${v.reasoning}`);
                }
                for (const v of low) {
                    const match = result.pii.phones.find(p => p.value === v.number);
                    const source = match?.source ?? 'unknown';
                    lines.push(`[LOW] ${v.number} — _${source}_\n  ${v.reasoning}`);
                }

                piiEmbed.addFields({
                    name: `Phones (${high.length + medium.length} likely from ${result.pii.phones.length} candidates)`,
                    value: lines.slice(0, 15).join('\n').slice(0, 1024) || 'No confident matches',
                    inline: false,
                });
            } else {
                // Fallback: no Gemini verification (timeout, etc.)
                const sortedPhones = [...result.pii.phones].sort((a, b) => b.count - a.count);
                piiEmbed.addFields({
                    name: `Phones (${sortedPhones.length} unverified)`,
                    value: sortedPhones.slice(0, 10).map(p =>
                        `${p.value}${p.count > 1 ? ` (${p.count}x)` : ''} — _${p.source}_`
                    ).join('\n'),
                    inline: false,
                });
            }
        }

        if (result.pii.emails.length > 0) {
            piiEmbed.addFields({
                name: `Emails (${result.pii.emails.length})`,
                value: result.pii.emails.slice(0, 10).map(e => `${e.value} — _${e.source}_`).join('\n'),
                inline: false,
            });
        }

        if (result.pii.names.length > 0) {
            const sortedNames = [...result.pii.names].sort((a, b) => b.count - a.count);
            piiEmbed.addFields({
                name: 'Possible Names',
                value: sortedNames.slice(0, 2).map(n =>
                    `${n.value} (${n.count}x) — _${n.source}_`
                ).join('\n'),
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
