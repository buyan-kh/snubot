import { search } from 'duck-duck-scrape';

async function testLib() {
    console.log('Testing duck-duck-scrape...');
    try {
        const results = await search('bitcoin', {
            safeSearch: 0 // Strict=0? No, usually 0=Strict, 1=Moderate, 2=Off? Check types. Actually verify via output.
        });

        console.log(`Found ${results.results.length} results.`);
        if (results.results.length > 0) {
            console.log('Top 3:', results.results.slice(0, 3));
        } else {
            console.log('No results.');
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

testLib();
