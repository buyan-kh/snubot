/**
 * WHOIS Lookup Module
 * Extracts registrant contact info from domain WHOIS records
 */

import { type Page } from 'playwright';
import { getBrowser } from '../lib/browser.js';
import { logger } from '../lib/index.js';

export interface WhoisResult {
    domain: string;
    registrantName: string | null;
    registrantOrg: string | null;
    registrantEmail: string | null;
    registrantPhone: string | null;
    registrantAddress: string | null;
    registrar: string | null;
    createdDate: string | null;
    expiresDate: string | null;
    nameservers: string[];
    rawWhois: string;
}

const PHONE_REGEX = /(?:(?:\+|00)\d{1,3})?[-.\s]?(?:\(?\d{1,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}/g;
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string | null {
    try {
        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
        return urlObj.hostname.replace(/^www\./, '');
    } catch {
        return null;
    }
}

/**
 * Perform WHOIS lookup using web-based service
 */
export async function whoisLookup(domainOrUrl: string): Promise<WhoisResult | null> {
    const domain = extractDomain(domainOrUrl);

    if (!domain) {
        logger.warn(`Invalid domain: ${domainOrUrl}`);
        return null;
    }

    const result: WhoisResult = {
        domain,
        registrantName: null,
        registrantOrg: null,
        registrantEmail: null,
        registrantPhone: null,
        registrantAddress: null,
        registrar: null,
        createdDate: null,
        expiresDate: null,
        nameservers: [],
        rawWhois: '',
    };

    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    try {
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        });

        // Use who.is (free WHOIS lookup service)
        const whoisUrl = `https://who.is/whois/${encodeURIComponent(domain)}`;
        await page.goto(whoisUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Get raw WHOIS text
        const whoisTextEl = await page.$('pre, .whois-data, #whois-raw');
        result.rawWhois = await whoisTextEl?.textContent() ?? '';

        if (!result.rawWhois) {
            logger.warn(`No WHOIS data found for ${domain}`);
            return null;
        }

        // Parse WHOIS data
        const lines = result.rawWhois.split('\n');

        for (const line of lines) {
            const lower = line.toLowerCase();

            // Registrant name
            if (lower.includes('registrant name:') || lower.includes('registrant:')) {
                result.registrantName = line.split(':')[1]?.trim() ?? null;
            }

            // Registrant org
            if (lower.includes('registrant organization:') || lower.includes('registrant org:')) {
                result.registrantOrg = line.split(':')[1]?.trim() ?? null;
            }

            // Registrar
            if (lower.includes('registrar:') && !result.registrar) {
                result.registrar = line.split(':')[1]?.trim() ?? null;
            }

            // Dates
            if (lower.includes('creation date:') || lower.includes('created:')) {
                result.createdDate = line.split(':')[1]?.trim() ?? null;
            }
            if (lower.includes('expir') && lower.includes('date:')) {
                result.expiresDate = line.split(':')[1]?.trim() ?? null;
            }

            // Nameservers
            if (lower.includes('name server:') || lower.includes('nserver:')) {
                const ns = line.split(':')[1]?.trim();
                if (ns) result.nameservers.push(ns);
            }
        }

        // Extract emails from raw WHOIS
        const emails = result.rawWhois.match(EMAIL_REGEX);
        if (emails && emails.length > 0) {
            // Filter out privacy/proxy emails
            const realEmails = emails.filter(e =>
                !e.includes('privacy') &&
                !e.includes('proxy') &&
                !e.includes('whoisguard') &&
                !e.includes('domainsbyproxy')
            );
            result.registrantEmail = realEmails[0] ?? null;
        }

        // Extract phones from raw WHOIS
        const phones = result.rawWhois.match(PHONE_REGEX);
        if (phones && phones.length > 0) {
            result.registrantPhone = phones[0];
        }

        logger.info(`WHOIS lookup complete for ${domain}`);

    } catch (error) {
        logger.warn(`WHOIS lookup failed for ${domain}:`, error);
        return null;
    } finally {
        await page.close();
    }

    return result;
}
