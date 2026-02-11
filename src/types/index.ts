export interface PIIItem {
    value: string;
    source: string;
}

export interface ExtractedPII {
    emails: PIIItem[];
    phones: PIIItem[];
    names: PIIItem[];
}

export interface TweetData {
    text: string;
    timestamp: string;
    links: string[];
}

export interface ScrapedPage {
    url: string;
    title: string;
    textContent: string;
    pii: ExtractedPII;
    error: string | null;
}

export interface BraveSearchResult {
    title: string;
    url: string;
    description: string;
}

export interface BraveSearchResponse {
    query: string;
    results: BraveSearchResult[];
}

export interface LookupResult {
    username: string;
    profileName: string;
    profileBio: string;
    profileLocation: string;
    tweets: TweetData[];
    scrapedPages: ScrapedPage[];
    braveSearches: BraveSearchResponse[];
    pii: ExtractedPII;
    executionTimeMs: number;
    errors: string[];
}
