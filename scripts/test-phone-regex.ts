/**
 * Test script for validating phone number extraction regex
 * Run with: npx ts-node scripts/test-phone-regex.ts
 */

const PHONE_PATTERNS = {
    // Matches: +1-555-555-5555, 555-555-5555, (555) 555-5555, +44 7700 900077
    general: /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g,
    // Broader international: starts with + or 00, followed by digits/spaces/dashes, min length 8
    international: /(?:(?:\+|00)\d{1,3})[-.\s]?(?:\d{1,4}[-.\s]?){1,4}\d{3,4}/g,
};

const TEST_CASES = [
    // US Formats
    "Call me at 555-123-4567",
    "My number is (555) 123-4567",
    "Contact: +1 555 123 4567",
    "Just 555.123.4567",

    // International
    "UK mobile: +44 7700 900077",
    "German landline: +49 30 12345678",
    "Australian: +61 412 345 678",

    // Noise / Negatives
    "The year is 2024-2025",
    "IP address 192.168.1.1",
    "Price is 1000.00",
    "ID: 1234567890",

    // Mixed text
    "Hey @user, my whatsapp is +1-555-0199 or try 555-0100 thanks!",
];

console.log("=== Testing Phone Regex ===\n");

function extractPhones(text: string): string[] {
    const phones1 = text.match(PHONE_PATTERNS.general) || [];
    const phones2 = text.match(PHONE_PATTERNS.international) || [];

    // Filter logic from deep-crawler.ts
    const allPhones = [...phones1, ...phones2].filter(p => {
        const digits = p.replace(/\D/g, '');
        // Valid phones usually 7-15 digits
        if (digits.length < 7 || digits.length > 15) return false;
        // Avoid years like 2020-2024
        if (p.match(/^\d{4}-\d{4}$/)) return false;
        // Avoid IP-like patterns (simple check)
        if (p.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) return false;

        return true;
    });

    return [...new Set(allPhones)];
}

TEST_CASES.forEach((text, i) => {
    const found = extractPhones(text);
    console.log(`[${i}] Text: "${text}"`);
    console.log(`    Found: ${JSON.stringify(found)}`);
    if (found.length === 0 && !text.includes("2024")) console.log("    ⚠️  WARNING: Missed potential phone?");
    console.log("---");
});
