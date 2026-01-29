import { chromium } from 'playwright';

async function testBing() {
    console.log('Launching browser...');
    const browser = await chromium.launch({ headless: true });
    // Use standard UA
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        console.log('Testing Bing...');
        await page.goto('https://www.bing.com/search?q=bitcoin', { waitUntil: 'domcontentloaded' });

        console.log('Page Title:', await page.title());

        const links = await page.$$eval('li.b_algo h2 a', els =>
            els.map(e => ({ txt: e.innerText, href: e.getAttribute('href') }))
        );

        console.log(`Found ${links.length} organic links from li.b_algo h2 a`);
        if (links.length > 0) {
            console.log('Top 3:', JSON.stringify(links.slice(0, 3), null, 2));
        } else {
            console.log('No links found. Body dump:');
            const content = await page.content();
            console.log(content.slice(0, 1000));
        }

    } catch (e) {
        console.error('Error:', e);
    }

    await browser.close();
}

testBing().catch(console.error);
