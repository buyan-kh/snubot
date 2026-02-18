import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { extractPII } from './pii-extractor.js';
import type { TweetData, ExtractedPII } from '../types/index.js';

const X_API_BASE = 'https://api.x.com/2';
const INITIAL_TWEETS = 50;
const EXTRA_TWEETS = 30;

export function parseUsername(input: string): string {
    let cleaned = input.trim();

    // Handle URLs: x.com/username or twitter.com/username
    const urlMatch = cleaned.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)/);
    if (urlMatch) return urlMatch[1];

    // Handle @prefix
    if (cleaned.startsWith('@')) cleaned = cleaned.slice(1);

    return cleaned;
}

interface ProfileMeta {
    displayName: string;
    bio: string;
    location: string;
    website: string;
    bioLinks: string[];
}

export interface ReferencedAuthor {
    username: string;
    displayName: string;
    bio: string;
}

export interface ScrapeResult {
    profile: ProfileMeta;
    tweets: TweetData[];
    referencedAuthorLinks: string[];
    referencedAuthors: ReferencedAuthor[];
    profilePII: ExtractedPII;
    errors: string[];
}

interface XUserResponse {
    data?: {
        id: string;
        name: string;
        username: string;
        description?: string;
        location?: string;
        url?: string;
        entities?: {
            url?: {
                urls?: Array<{ expanded_url?: string }>;
            };
            description?: {
                urls?: Array<{ expanded_url?: string; display_url?: string }>;
            };
        };
    };
    errors?: Array<{ title: string; detail: string }>;
}

interface XTweetEntity {
    urls?: Array<{
        expanded_url: string;
        display_url: string;
    }>;
}

interface XTweet {
    id: string;
    text: string;
    created_at?: string;
    entities?: XTweetEntity;
    referenced_tweets?: Array<{
        type: 'retweeted' | 'quoted' | 'replied_to';
        id: string;
    }>;
    note_tweet?: {
        text?: string;
        entities?: XTweetEntity;
    };
}

interface XIncludedUser {
    id: string;
    username: string;
    name: string;
    description?: string;
    url?: string;
    entities?: {
        url?: {
            urls?: Array<{ expanded_url?: string }>;
        };
        description?: {
            urls?: Array<{ expanded_url?: string; display_url?: string }>;
        };
    };
}

interface XTweetsResponse {
    data?: XTweet[];
    includes?: {
        tweets?: XTweet[];
        users?: XIncludedUser[];
    };
    meta?: {
        next_token?: string;
        result_count?: number;
    };
    errors?: Array<{ title: string; detail: string }>;
}

const SKIP_DOMAINS = [
    'y.com'
];

function isExternalLink(url: string): boolean {
    try {
        const hostname = new URL(url).hostname;
        return !SKIP_DOMAINS.some(d => hostname.includes(d));
    } catch {
        return false;
    }
}

function buildHeaders(): Record<string, string> {
    return {
        'Authorization': `Bearer ${config.X_BEARER_TOKEN}`,
        'Content-Type': 'application/json',
    };
}

async function resolveUserId(username: string): Promise<XUserResponse> {
    const url = `${X_API_BASE}/users/by/username/${encodeURIComponent(username)}`;
    const params = {
        'user.fields': 'description,location,url,name,entities',
    };

    const response = await axios.get<XUserResponse>(url, {
        headers: buildHeaders(),
        params,
        timeout: 10000,
    });

    return response.data;
}

async function fetchTweetPage(userId: string, count: number, paginationToken?: string): Promise<{ tweets: XTweet[]; includedTweets: XTweet[]; includedUsers: XIncludedUser[]; nextToken?: string; errors: string[] }> {
    const errors: string[] = [];
    const params: Record<string, string> = {
        'max_results': String(count),
        'tweet.fields': 'created_at,entities,text,referenced_tweets,note_tweet',
        'expansions': 'referenced_tweets.id,referenced_tweets.id.author_id',
        'user.fields': 'username,name,description,url,entities',
    };
    if (paginationToken) {
        params['pagination_token'] = paginationToken;
    }

    try {
        const response = await axios.get<XTweetsResponse>(
            `${X_API_BASE}/users/${userId}/tweets`,
            { headers: buildHeaders(), params, timeout: 15000 },
        );
        const data = response.data;

        if (data.errors?.length) {
            for (const err of data.errors) {
                errors.push(`X API: ${err.title} - ${err.detail}`);
            }
        }

        const result: { tweets: XTweet[]; includedTweets: XTweet[]; includedUsers: XIncludedUser[]; nextToken?: string; errors: string[] } = {
            tweets: data.data ?? [],
            includedTweets: data.includes?.tweets ?? [],
            includedUsers: data.includes?.users ?? [],
            errors,
        };
        if (data.meta?.next_token) result.nextToken = data.meta.next_token;
        return result;
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Tweet fetch failed';
        return { tweets: [], includedTweets: [], includedUsers: [], errors: [msg] };
    }
}

function tweetsHaveUrls(tweets: XTweet[]): boolean {
    return tweets.some(t => t.entities?.urls?.some(u => isExternalLink(u.expanded_url)));
}

async function fetchUserTweets(userId: string): Promise<{ tweets: XTweet[]; includedTweets: Map<string, XTweet>; referencedAuthors: XIncludedUser[]; errors: string[] }> {
    const includedMap = new Map<string, XTweet>();
    const userMap = new Map<string, XIncludedUser>();

    // Fetch initial batch
    const first = await fetchTweetPage(userId, INITIAL_TWEETS);
    const allTweets = [...first.tweets];
    const errors = [...first.errors];
    for (const t of first.includedTweets) includedMap.set(t.id, t);
    for (const u of first.includedUsers) userMap.set(u.id, u);

    // If no URLs found in first batch, fetch more
    if (!tweetsHaveUrls(allTweets) && first.nextToken) {
        logger.info(`No URLs in first ${allTweets.length} tweets, fetching ${EXTRA_TWEETS} more...`);
        const second = await fetchTweetPage(userId, EXTRA_TWEETS, first.nextToken);
        allTweets.push(...second.tweets);
        errors.push(...second.errors);
        for (const t of second.includedTweets) includedMap.set(t.id, t);
        for (const u of second.includedUsers) userMap.set(u.id, u);
    }

    // Remove the target user from referenced authors
    userMap.delete(userId);

    return { tweets: allTweets, includedTweets: includedMap, referencedAuthors: [...userMap.values()], errors };
}

export async function scrapeTweets(username: string): Promise<ScrapeResult> {
    const result: ScrapeResult = {
        profile: { displayName: '', bio: '', location: '', website: '', bioLinks: [] },
        tweets: [],
        referencedAuthorLinks: [],
        referencedAuthors: [],
        profilePII: { emails: [], phones: [], names: [] } as ExtractedPII,
        errors: [],
    };

    try {
        // Step 1: Resolve username to user ID + profile metadata
        logger.info(`Resolving X user: @${username}`);
        const userResponse = await resolveUserId(username);

        if (userResponse.errors?.length) {
            for (const err of userResponse.errors) {
                result.errors.push(`X API user lookup: ${err.title} - ${err.detail}`);
            }
        }

        if (!userResponse.data) {
            result.errors.push(`User @${username} not found on X`);
            return result;
        }

        const user = userResponse.data;
        result.profile.displayName = user.name;
        result.profile.bio = user.description ?? '';
        result.profile.location = user.location ?? '';

        // Extract expanded website URL from entities
        const websiteUrl = user.entities?.url?.urls?.[0]?.expanded_url;
        result.profile.website = websiteUrl ?? user.url ?? '';

        // Extract expanded links from bio
        const bioLinks: string[] = [];
        if (user.entities?.description?.urls) {
            for (const urlEntity of user.entities.description.urls) {
                if (urlEntity.expanded_url && isExternalLink(urlEntity.expanded_url)) {
                    bioLinks.push(urlEntity.expanded_url);
                }
            }
        }
        result.profile.bioLinks = bioLinks;

        // Extract PII from profile text (exclude location to avoid false name matches)
        const profileText = `${result.profile.bio}`;
        result.profilePII = extractPII(profileText, `https://x.com/${username}`);

        // Always include X display name as a known name
        if (result.profile.displayName) {
            const name = result.profile.displayName.trim();
            if (name && !result.profilePII.names.some(n => n.value === name)) {
                result.profilePII.names.unshift({ value: name, source: `https://x.com/${username}`, count: 1 });
            }
        }

        // Step 2: Fetch tweets (includes retweets + quoted tweet expansions + author profiles)
        logger.info(`Fetching tweets for @${username} (ID: ${user.id})`);
        const { tweets: rawTweets, includedTweets, referencedAuthors, errors: tweetErrors } = await fetchUserTweets(user.id);
        result.errors.push(...tweetErrors);

        // Step 3: Transform tweets into our format
        for (const tweet of rawTweets) {
            const links: string[] = [];
            let text = tweet.text;

            // Use long-form note_tweet text if available
            if (tweet.note_tweet?.text) {
                text = tweet.note_tweet.text;
            }

            // Extract expanded URLs from entities (proper URL expansion)
            const allEntities = [tweet.entities, tweet.note_tweet?.entities];
            for (const entities of allEntities) {
                if (entities?.urls) {
                    for (const urlEntity of entities.urls) {
                        if (isExternalLink(urlEntity.expanded_url)) {
                            links.push(urlEntity.expanded_url);
                        }
                    }
                }
            }

            // Extract links and text from referenced tweets (quoted/retweeted)
            if (tweet.referenced_tweets) {
                for (const ref of tweet.referenced_tweets) {
                    const refTweet = includedTweets.get(ref.id);
                    if (!refTweet) continue;

                    const refText = refTweet.note_tweet?.text ?? refTweet.text;
                    text += `\n${refText}`;

                    const refEntities = [refTweet.entities, refTweet.note_tweet?.entities];
                    for (const entities of refEntities) {
                        if (entities?.urls) {
                            for (const urlEntity of entities.urls) {
                                if (isExternalLink(urlEntity.expanded_url)) {
                                    links.push(urlEntity.expanded_url);
                                }
                            }
                        }
                    }
                }
            }

            result.tweets.push({
                text,
                timestamp: tweet.created_at ?? '',
                links: [...new Set(links)],
            });
        }

        // Step 4: Collect website/bio links from retweeted/quoted authors' profiles
        const authorLinks: string[] = [];
        for (const author of referencedAuthors) {
            const website = author.entities?.url?.urls?.[0]?.expanded_url ?? author.url;
            if (website && isExternalLink(website)) {
                authorLinks.push(website);
            }
            if (author.entities?.description?.urls) {
                for (const urlEntity of author.entities.description.urls) {
                    if (urlEntity.expanded_url && isExternalLink(urlEntity.expanded_url)) {
                        authorLinks.push(urlEntity.expanded_url);
                    }
                }
            }
        }
        result.referencedAuthorLinks = [...new Set(authorLinks)];
        result.referencedAuthors = referencedAuthors
            .filter(a => a.description)
            .map(a => ({ username: a.username, displayName: a.name, bio: a.description ?? '' }));
        if (result.referencedAuthorLinks.length > 0) {
            logger.info(`Found ${result.referencedAuthorLinks.length} links from ${referencedAuthors.length} retweeted/quoted authors`);
        }

        logger.info(`Fetched ${result.tweets.length} tweets from @${username} via X API`);
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            const detail = error.response?.data?.detail ?? error.response?.data?.title ?? error.message;

            if (status === 401) {
                result.errors.push('X API: Invalid or expired bearer token. Check X_BEARER_TOKEN in .env');
            } else if (status === 403) {
                result.errors.push('X API: Access forbidden. Your API tier may not support this endpoint.');
            } else if (status === 429) {
                result.errors.push('X API: Rate limit exceeded. Try again later.');
            } else {
                result.errors.push(`X API error (${status}): ${detail}`);
            }
        } else {
            const msg = error instanceof Error ? error.message : 'Tweet fetch failed';
            result.errors.push(msg);
        }

        logger.error(`Failed to fetch tweets for @${username}:`, result.errors);
    }

    return result;
}
