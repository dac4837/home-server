const axios = require('axios');
const fs = require('fs');
const path = require('path');


const CARD_BULK_TYPE = 'default_cards'//'default_cards' 'oracle_cards'
const CARD_BULK_URL = 'https://api.scryfall.com/bulk-data'
const RATE_LIMIT_DELAY_MS = 250;
const CARD_CACHE_FILE = 'card-cache.json';


const CARD_MAP = {
    'Forest': 'https://cards.scryfall.io/png/front/e/d/ed22c591-19f4-4096-a08c-5523a26b307c.png?1738799053',
    'Plains': 'https://cards.scryfall.io/png/front/5/d/5d918248-85ff-4fea-ac91-aa5466dd2829.png?1681845990',
    'Swamp': 'https://cards.scryfall.io/png/front/a/2/a22f49c5-1dcd-453c-b169-0b2519c44d0c.png?1695483859',
    'Mountain': 'https://cards.scryfall.io/png/front/8/a/8a05eb4e-dbea-4d41-939f-b9d92b56f56a.png?1605219735',
    'Island': 'https://cards.scryfall.io/png/front/9/3/93b0918a-398a-4c6d-a5a9-e35a999b24ae.png?1594958716',
    'Wastes': 'https://cards.scryfall.io/png/front/7/0/7019912c-bd9b-4b96-9388-400794909aa1.png?1562917413',
    'Sol Ring': 'https://cards.scryfall.io/png/front/9/1/9138d11a-d55f-4c46-bb27-7e8e15a44e8c.png?1559592963',
    'Skullclamp': 'https://cards.scryfall.io/png/front/3/6/3668996e-659d-413b-84e6-9f3099518d7f.png?1682693957',
    'Counterspell': 'https://cards.scryfall.io/png/front/1/b/1b73577a-8ca1-41d7-9b2b-7300286fde43.png?1680795078',
    'Command Tower': 'https://cards.scryfall.io/png/front/f/f/ffcf7acb-23e4-4658-a5fd-0ae585602dca.png?1765895204',
    'Arcane Signet': 'https://cards.scryfall.io/png/front/2/a/2ac9fdee-ad50-486a-9fde-4aba6848a6c6.png?1668111158',
    'Swiftfoot Boots': 'https://cards.scryfall.io/png/front/3/e/3e9b53da-4744-429d-97c6-f7ee4d568731.png?1730489931',
    'Swords to Plowshares': 'https://cards.scryfall.io/png/front/c/d/cd33c0f5-5545-477a-9185-53c707983795.png?1608918394',
    'Cyclonic Rift': 'https://cards.scryfall.io/png/front/2/0/2064a0d6-3739-4466-9657-be694c0eb6e1.png?1702429855',
    'Blasphemous Act': 'https://cards.scryfall.io/png/front/4/a/4a184a4a-2c8c-4a10-9b26-a174859fa1e8.png?1682689918',
    'Path of Ancestry': 'https://cards.scryfall.io/png/front/7/f/7f3d574a-72b5-43be-b4b5-87865bbc7b5c.png?1690002409',
    'Fellwar Stone': 'https://cards.scryfall.io/png/front/a/a/aa15d3b3-c709-4d9b-a9ec-c8d68f805ebf.png?1697475825',
    'Farseek': 'https://cards.scryfall.io/png/front/1/c/1cc0bdf2-3db7-4ebb-82d9-cc94d7cf10c0.png?1759244604',
    "Kodama's Reach": 'https://cards.scryfall.io/png/front/b/0/b0506e30-ed0d-4838-97b1-55900ad633b5.png?1690002274'
}

async function downloadCardBulkData() {
    const response = await axios.get(CARD_BULK_URL);

    const bulkDataList = response.data.data;
    const cardsUri = bulkDataList.find(data => data.type === CARD_BULK_TYPE).download_uri;

    console.log('Downloading cards from', cardsUri);

    const defaultCardsResponse = await axios.get(cardsUri);
    const defaultCardsData = defaultCardsResponse.data;

    console.log(defaultCardsData.length, 'cards downloaded');

    return defaultCardsData;
}

function getCardById(cards, id) {
    return cards.find(card => card.id === id);
}

function getImagesFromCardData(cardData) {

    let metadata = {}

    try {

        if (cardData.card_faces && cardData.card_faces.length > 1 && cardData.card_faces[0].image_uris && cardData.card_faces[1].image_uris) {
            metadata.front = cardData.card_faces[0].image_uris.large
            metadata.back = cardData.card_faces[1].image_uris.large
        } else {
            metadata.front = cardData.image_uris.large
        }
    } catch (e) {
        console.error('Error getting front/back images for card', cardData);
        throw e;
    }

    return metadata;

}

async function getMetadataFromCardData(cardData, tokenCache, cards) {

    let metadata = getImagesFromCardData(cardData);

    if (cardData.all_parts) {
        const tokenParts = cardData.all_parts.filter(part => part.type_line.startsWith('Token') || part.type_line.startsWith('Emblem'));

        if (tokenParts.length > 0) {
            metadata.tokens = [];

            for (const tokenPart of tokenParts) {
                if (tokenCache[tokenPart.id]) {
                    metadata.tokens.push(tokenCache[tokenPart.id]);
                } else {

                    let tokenData = getCardById(cards, tokenPart.id);

                    if (!tokenData) {
                        const tokenResponse = await axios.get(tokenPart.uri);
                        tokenData = tokenResponse.data;

                        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));

                        if (!tokenData) {
                            console.warn('Could not retrieve token data for', tokenPart.uri);
                            continue;
                        }

                    }

                    const tokenImages = getImagesFromCardData(tokenData);

                    const tokenEntry = {
                        name: tokenData.name,
                        ...tokenImages
                    };

                    tokenCache[tokenPart.id] = tokenEntry;

                    metadata.tokens.push(tokenEntry);
                }
            }
        }
    }

    if (cardData.oracle_id) {
        metadata.oracle_id = cardData.oracle_id;
    }

    metadata.name = cardData.name

    return metadata

}

async function saveCacheToFile(data) {
    const cardCache = path.join(__dirname, CARD_CACHE_FILE);
    fs.writeFileSync(cardCache, JSON.stringify(data), 'utf-8');
}

function shouldSkipCard(card) {
    return !card.type_line || !card.image_status || card.image_status === 'missing' || card.type_line.startsWith('Token') || card.type_line.startsWith('Emblem') || card.layout === 'art_series' || card.set_type === 'minigame';
}

function addAltNames(metadata, cardMetadata) {

    if (cardMetadata.name.includes(' // ')) {

        const nameParts = cardMetadata.name.split(' // ');

        for (const part of nameParts) {
            if (!metadata[part]) {
                metadata[part] = cardMetadata;
            }
        }
    }

}

async function convertToMetadata(cards) {

    const metadata = {};
    const tokenCache = {};

    for (const card of cards) {

        if (shouldSkipCard(card)) {
            continue;
        }
        const cardMetadata = await getMetadataFromCardData(card, tokenCache, cards);
        metadata[card.name] = cardMetadata;
        addAltNames(metadata, cardMetadata);
    }

    console.log("Processed", Object.keys(metadata).length, "cards with", Object.keys(tokenCache).length, "unique tokens.");

    return metadata;

}


function injectCustomArt(metadata) {
    for (const [cardName, imageUrl] of Object.entries(CARD_MAP)) {
        if (metadata[cardName]) {
            metadata[cardName].front = imageUrl;
        } else {
            throw new Error(`Card "${cardName}" not found in cache.`);
        }
    }
}

async function main() {
    const cards = await downloadCardBulkData();
    const metadata = await convertToMetadata(cards);
    injectCustomArt(metadata);
    await saveCacheToFile(metadata);
    console.log('Card metadata cache saved to', CARD_CACHE_FILE);
}

main();