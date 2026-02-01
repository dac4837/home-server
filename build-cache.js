const axios = require('axios');
const fs = require('fs');
const path = require('path');


const CARD_BULK_TYPE = 'default_cards'//'default_cards' 'oracle_cards'
const CARD_BULK_URL = 'https://api.scryfall.com/bulk-data'
const RATE_LIMIT_DELAY_MS = 250;
const CARD_CACHE_FILE = 'card-cache.json';

const FOREST_URL = 'https://cards.scryfall.io/png/front/e/d/ed22c591-19f4-4096-a08c-5523a26b307c.png?1738799053'
  const PLAINS_URL = 'https://cards.scryfall.io/png/front/5/d/5d918248-85ff-4fea-ac91-aa5466dd2829.png?1681845990'
  const SWAMP_URL = 'https://cards.scryfall.io/png/front/a/2/a22f49c5-1dcd-453c-b169-0b2519c44d0c.png?1695483859'
  const MOUNTAIN_URL = 'https://cards.scryfall.io/png/front/8/a/8a05eb4e-dbea-4d41-939f-b9d92b56f56a.png?1605219735'
  const ISLAND_URL = 'https://cards.scryfall.io/png/front/9/3/93b0918a-398a-4c6d-a5a9-e35a999b24ae.png?1594958716'
  const WASTES_URL = 'https://cards.scryfall.io/png/front/7/0/7019912c-bd9b-4b96-9388-400794909aa1.png?1562917413'

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
    return !card.type_line || !card.image_status || card.image_status === 'missing' || card.type_line.startsWith('Token') || card.type_line.startsWith('Emblem') || card.layout === 'art_series' || card.set_type === 'minigame' ;
}

async function convertToMetadata(cards) {

    const metadata = {};
    const tokenCache = {};

    // let i = 0;

    for (const card of cards) {

        if (shouldSkipCard(card)) {
            continue;
        }
        const cardMetadata = await getMetadataFromCardData(card, tokenCache, cards);
        metadata[card.name] = cardMetadata;

        // if (i++ > 1100) break;
    }


    console.log("Processed", Object.keys(metadata).length, "cards with", Object.keys(tokenCache).length, "unique tokens.");

    return metadata;

}

function injectBasicLands(metadata) {
    metadata['Forest'].front = FOREST_URL;
    metadata['Plains'].front = PLAINS_URL;
    metadata['Swamp'].front = SWAMP_URL;
    metadata['Mountain'].front = MOUNTAIN_URL;
    metadata['Island'].front = ISLAND_URL;
    metadata['Wastes'].front = WASTES_URL;
}

async function main() {
    const cards = await downloadCardBulkData();
    const metadata = await convertToMetadata(cards);
    injectBasicLands(metadata);
    await saveCacheToFile(metadata);
    console.log('Card metadata cache saved to', CARD_CACHE_FILE);
}

main();