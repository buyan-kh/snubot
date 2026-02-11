import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { extractPII } from './pii-extractor.js';
import type { TweetData, ExtractedPII } from '../types/index.js';

const X_API_BASE = 'https://api.x.com/2';
const MAX_PAGES = 1;
const TWEETS_PER_PAGE = 20;

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

export interface ScrapeResult {
    profile: ProfileMeta;
    tweets: TweetData[];
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
}

interface XTweetsResponse {
    data?: XTweet[];
    meta?: {
        next_token?: string;
        result_count?: number;
    };
    errors?: Array<{ title: string; detail: string }>;
}

const SKIP_DOMAINS = [
    'x.com', 'twitter.com',
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

async function fetchUserTweets(userId: string): Promise<{ tweets: XTweet[]; errors: string[] }> {
    const allTweets: XTweet[] = [];
    const errors: string[] = [];
    let paginationToken: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
        try {
            const params: Record<string, string> = {
                'max_results': String(TWEETS_PER_PAGE),
                'exclude': 'retweets',
                'tweet.fields': 'created_at,entities,text',
            };

            if (paginationToken) {
                params['pagination_token'] = paginationToken;
            }

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

            if (data.data) {
                allTweets.push(...data.data);
            }

            if (!data.meta?.next_token || (data.meta?.result_count ?? 0) === 0) {
                break;
            }

            paginationToken = data.meta.next_token;
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Tweet fetch failed';
            errors.push(msg);
            break;
        }
    }

    return { tweets: allTweets, errors };
}

export async function scrapeTweets(username: string): Promise<ScrapeResult> {
    const result: ScrapeResult = {
        profile: { displayName: '', bio: '', location: '', website: '', bioLinks: [] },
        tweets: [],
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
                result.profilePII.names.unshift({ value: name, source: `https://x.com/${username}` });
            }
        }

        // Step 2: Fetch tweets
        logger.info(`Fetching tweets for @${username} (ID: ${user.id})`);
        const { tweets: rawTweets, errors: tweetErrors } = await fetchUserTweets(user.id);
        result.errors.push(...tweetErrors);

        // Step 3: Transform tweets into our format
        for (const tweet of rawTweets) {
            const links: string[] = [];

            // Extract expanded URLs from entities (proper URL expansion)
            if (tweet.entities?.urls) {
                for (const urlEntity of tweet.entities.urls) {
                    if (isExternalLink(urlEntity.expanded_url)) {
                        links.push(urlEntity.expanded_url);
                    }
                }
            }

            result.tweets.push({
                text: tweet.text,
                timestamp: tweet.created_at ?? '',
                links: [...new Set(links)],
            });
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
