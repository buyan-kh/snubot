/**
 * OSINT Bot Type Definitions
 * All interfaces for OSINT module responses
 */

export interface XProfileResult {
    username: string;
    displayName: string;
    bio: string;
    location: string;
    website: string;
    profileImageUrl: string;
    bannerImageUrl: string | null;
    followers: number;
    following: number;
    tweetCount: number;
    joinedDate: string;
    verified: boolean;
    suggestedSearches: string[];
    errors: string[];
}

export interface BreachInfo {
    name: string;
    domain: string;
    breachDate: string;
    dataClasses: string[];
}

export interface EmailResult {
    email: string;
    breachCount: number;
    breaches: BreachInfo[];
    gravatarUrl: string | null;
    gravatarExists: boolean;
    domain: string;
    suggestedSearches: string[];
    errors: string[];
}

export interface FoundProfile {
    platform: string;
    url: string;
    username: string;
    category: string;
    metadata?: Record<string, unknown>;
}

export interface UsernameResult {
    username: string;
    foundProfiles: FoundProfile[];
    totalChecked: number;
    executionTimeMs: number;
    suggestedSearches: string[];
    errors: string[];
}

export interface OsintModuleResult<T> {
    success: boolean;
    data: T | null;
    error: string | null;
    cached: boolean;
    timestamp: string;
}

export type InputType = 'x_username' | 'email' | 'username' | 'unknown';

export interface InputClassification {
    type: InputType;
    value: string;
    normalized: string;
}
