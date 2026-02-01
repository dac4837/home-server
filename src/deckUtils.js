const { JSDOM } = require('jsdom');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cardCache = path.join(__dirname, '..', 'card-cache.json');

const metadataApi = process.env.CARD_IMAGE_API;

let metadataCache = {};

async function generateDeckJson(input) {

    await loadCache();

    const deckData = await getDeckData(input);

    const deckJson = convertToTableTop(deckData);

    return deckJson;
}

async function getDeckData(deckUrl) {

    const deckRequest = await axios.get(deckUrl)

    const document = getDocumentForHtml(deckRequest.data)

    const mainBoard = await getMainBoardCards(document)

    const commanders = await getCommanders(document)

    const allCards = Array.isArray(commanders) && commanders.length ? mainBoard.concat(commanders) : mainBoard;
    const tokens = getTokens(allCards)

    return {
        commanders,
        mainBoard,
        tokens
    }
}

async function generateDeckJsonFromList(cardNames) {
    await loadCache();

    const cards = []
    for (const card of cardNames) {
        const cardObj = await createCardObject(card)
        if (cardObj) {
            cards.push(cardObj)
        }
    }

    if (cards.length === 0) {
        throw new Error("No valid cards found in list")
    }

    const tokens = getTokens(cards)

    const deckData = {
        commanders: [],
        mainBoard: cards,
        tokens
    }

    const deckJson = convertToTableTop(deckData);

    return deckJson;
}

async function loadCache() {
    try {
        const data = await fs.promises.readFile(cardCache, 'utf8');
        metadataCache = JSON.parse(data);
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            // cache file doesn't exist yet — start with empty cache
            metadataCache = {};
            try {
                await fs.promises.writeFile(cardCache, JSON.stringify(metadataCache, null, 2));
            } catch (writeErr) {
                console.error('Error creating card cache file:', writeErr);
            }
            return;
        }

        console.error('Error reading or parsing card cache file:', err);
        throw err;
    }
}


function addToCache(name, metadata) {
    metadataCache[name] = metadata;

    fs.writeFile(cardCache, JSON.stringify(metadataCache, null, 2), (writeErr) => {
        if (writeErr) {
            console.error('Error saving card cache:', writeErr);
        }
    });
}

function getDocumentForHtml(html) {
    const dom = new JSDOM(html);
    return dom.window.document;
}

async function getMainBoardCards(document) {
    const cardLINodes = document.querySelectorAll('li.member[id^="boardContainer-main"]');

    if (!cardLINodes || cardLINodes.length === 0) {
        throw new Error('Cannot find cards');
    }

    const cardLIs = Array.from(cardLINodes);
    const results = [];

    for (const card of cardLIs) {
        const result = await createCardObjectFromHtml(card);
        results.push(result);
    }

    return results;
}

async function createCardObjectFromHtml(card) {
    const cardAElement = card.querySelector('a[data-qty]');

    if (!cardAElement) {
        throw new Error('invalid card data');
    }

    const name = cardAElement.getAttribute('data-name');
    const quantity = parseInt(cardAElement.getAttribute('data-qty'), 10);

    if (!name || !quantity) {
        throw new Error('invalid card data');
    }

    const metadata = await getCardMetadata(name);

    if(!metadata) {
        throw new Error('Could not get card data for card: ' + name);
    }

    return {
        quantity,
        ...metadata
    };
}

async function createCardObject(card) {
    const metadata = await getCardMetadata(card);

    return metadata ? {
        quantity: 1,
        ...metadata
    } : null;
}

function metadataSearchUrl(cardName) {

    return `${metadataApi}${cardName.replace(/ /g, '+')}`

}

async function getMetadataFromCardData(cardData) {

    let metadata = {}

    if (cardData.card_faces && cardData.card_faces.length > 1 && cardData.card_faces[0].image_uris && cardData.card_faces[1].image_uris) {
        metadata.front = cardData.card_faces[0].image_uris.large
        metadata.back = cardData.card_faces[1].image_uris.large
    } else {
        metadata.front = cardData.image_uris.large
    }

    if (cardData.all_parts) {
        const tokenParts = cardData.all_parts.filter(part => part.type_line.startsWith('Token') || part.type_line.startsWith('Emblem'));

        if (tokenParts.length > 0) {
            metadata.tokens = [];

            for (const tokenPart of tokenParts) {
                try {
                    const tokenResponse = await axios.get(tokenPart.uri);
                    const tokenData = tokenResponse.data;

                    if (tokenData && tokenData.name && tokenData.image_uris && tokenData.image_uris.large) {
                        metadata.tokens.push({
                            name: tokenData.name,
                            front: tokenData.image_uris.large
                        });
                    }
                } catch (error) {
                    console.error(`Error fetching token data from ${tokenPart.uri}:`, error);
                }
            }
        }
    }

    metadata.name = cardData.name

    return metadata

}

async function getCardMetadata(cardName) {

    if (metadataCache[cardName]) {
        return metadataCache[cardName]
    }

    try {

        console.log("Fetching metadata for card:", cardName)

        const metadataDataResponse = await axios.get(metadataSearchUrl(cardName))

        const metadata = await getMetadataFromCardData(metadataDataResponse.data)

        addToCache(cardName, metadata)

        if (cardName !== metadata.name) {
            addToCache(metadata.name, metadata)
        }

        return metadata

    } catch (err) {
        if(err.status && err.status === 404) {
            console.error('Card not found:', cardName)
            return null
        } else {
            console.error('Error getting card metadata for', cardName, err)
            throw err
        }
    }
}

async function getCommanders(document) {
    const h3Elements = document.querySelectorAll("h3");

    const aElements = getCommanderAElements(h3Elements);
    const commanders = [];

    for (const a of aElements) {
        try {
            const obj = await createCommanderObject(a);
            if (obj) commanders.push(obj);
        } catch (err) {
            console.error('Error creating commander object', err);
        }
    }

    if (commanders.length === 0) {
        console.log("No commander card found")
    }

    return commanders;
}

function getCommanderAElements(h3Elements) {
    const results = [];

    for (let h3 of h3Elements) {
        if (h3.textContent.includes("Commander")) {
            let next = h3.nextElementSibling;
            // walk siblings until we hit another header (next section)
            while (next && next.tagName !== 'H3') {
                // collect all anchor elements within this sibling (row may contain multiple commanders)
                const aTags = next.querySelectorAll("a");
                if (aTags && aTags.length) {
                    aTags.forEach(a => results.push(a));
                }
                next = next.nextElementSibling;
            }
            break;
        }
    }

    return results;
}

async function createCommanderObject(aElement) {
    const name = aElement.getAttribute('data-name')

    if (!name) {
        throw new Error("Error getting commander info")
    }
    const metadata = await getCardMetadata(name)

    if(!metadata) {
        throw new Error('Could not get card data for commander: ' + name);
    }

    return metadata
}

function getTokens(cards) {

    const tokens = [];

    cards.forEach(card => {
        if (card.tokens && Array.isArray(card.tokens)) {
            card.tokens.forEach(token => {
                if (!tokens.some(existingToken => existingToken.name === token.name && existingToken.front === token.front)) {
                    tokens.push(token);
                }
            });
        }
    });

    // sort tokens alphabetically by name (case-insensitive)
    tokens.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));

    return tokens;
}


function convertToTableTop(deckData) {
    const deck = {
        ObjectStates: []
    };

    let pileNumber = 0;

    const createContainedObjectsEntry = (card, id) => ({
        CardID: id,
        Name: "Card",
        Nickname: card.name,
        Transform: {
            posX: 0,
            posY: 0,
            posZ: 0,
            rotX: 0,
            rotY: 180,
            rotZ: 180,
            scaleX: 1,
            scaleY: 1,
            scaleZ: 1
        }
    });

    const createCustomDeckEntry = (card, id, useBack = false) => ({
        [id]: {
            FaceURL: card.front,
            BackURL: useBack ? card.back : "https://i.imgur.com/Hg8CwwU.jpeg",
            NumHeight: 1,
            NumWidth: 1,
            BackIsHidden: true
        }
    });

    const createTransform = (i, faceup) => {
        return {
            posX: i * 2.2,
            posY: 1,
            posZ: 0,
            rotX: 0,
            rotY: 180,
            rotZ: faceup ? 0 : 180,
            scaleX: 1,
            scaleY: 1,
            scaleZ: 1
        };
    }

    const createPile = (cards, pipeNumber, pileName, options = { faceUp: false, useBack: false }) => {

        const customDeck = {};
        const containedObjects = []

        let i = 1;

        for (const card of cards) {

            const cardCount = card.quantity || 1;

            for (let j = 0; j < cardCount; j++) {
                Object.assign(customDeck, createCustomDeckEntry(card, i, options.useBack));
                containedObjects.push(createContainedObjectsEntry(card, 100 * i));
                i++;
            }
        }

        const deckIDs = containedObjects.map(obj => obj.CardID);

        const transform = createTransform(pipeNumber, options.faceUp);

        return {
            Name: "DeckCustom",
            Nickname: pileName,
            Description: pileName,
            ContainedObjects: containedObjects,
            DeckIDs: deckIDs,
            CustomDeck: customDeck,
            Transform: transform
        };
    }

    const createSingleCardPipe = (card, pipeNumber, pileName, options = { useBack: false }) => {
        const customDeck = createCustomDeckEntry(card, 1, options.useBack);

        return {
            Name: "Card",
            CustomDeck: customDeck,
            CardID: 100,
            Nickname: card.name,
            Description: pileName,
            Transform: createTransform(pipeNumber, true)
        };
    }

    deck.ObjectStates.push(createPile(deckData.mainBoard, pileNumber++, "Mainboard"));

    // Commanders: `deckData.commanders` is an array (may be empty)
    if (deckData.commanders && Array.isArray(deckData.commanders) && deckData.commanders.length) {
        if (deckData.commanders.length === 1) {
            const useBack = deckData.commanders[0].back !== undefined;
            deck.ObjectStates.push(createSingleCardPipe(deckData.commanders[0], pileNumber++, "Commander", { useBack }));
        } else {
            // Group multiple commanders into a single pile named "Commander"
            // If any commander has a back image, set useBack so backs are used where available
            const anyHasBack = deckData.commanders.some(c => c.back !== undefined);
            deck.ObjectStates.push(createPile(deckData.commanders, pileNumber++, "Commander", { faceUp: true, useBack: anyHasBack }));
        }
    }

    // Tokens: if only one token, use single card pipe, otherwise a pile
    if (deckData.tokens && Array.isArray(deckData.tokens) && deckData.tokens.length === 1) {
        deck.ObjectStates.push(createSingleCardPipe(deckData.tokens[0], pileNumber++, "Tokens", { useBack: true }));
    } else {
        deck.ObjectStates.push(createPile(deckData.tokens || [], pileNumber++, "Tokens", { faceUp: true, useBack: true }));
    }

    const cardsWithBacks = deckData.mainBoard.filter(card => card.back !== undefined);

    if (cardsWithBacks.length === 1) {
        deck.ObjectStates.push(createSingleCardPipe(cardsWithBacks[0], pileNumber++, "Double-sided Cards", { useBack: true }));
    } else if (cardsWithBacks.length > 1) {
        deck.ObjectStates.push(createPile(cardsWithBacks, pileNumber++, "Double-sided Cards", { faceUp: true, useBack: true }));
    }

    return deck;
}

module.exports = {
    generateDeckJson,
    generateDeckJsonFromList

};