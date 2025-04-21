const { JSDOM } = require('jsdom');
const axios = require('axios');

const imageApi = process.env.CARD_IMAGE_API;

async function generateDeckJson(input) {

    const deckData = await getDeckData(input);

    const deckJson = convertToTableTop(deckData);

    return deckJson;
}

async function getDeckData(deckUrl) {

    const deckRequest = await axios.get(deckUrl)

    const document = getDocumentForHtml(deckRequest.data)

    const mainBoard = await getMainBoardCards(document)

    const tokens = getTokens(document)

    const commander = await getCommander(document)


    return {
        commander,
        mainBoard,
        tokens
    }
}

function getDocumentForHtml(html) {
    const dom = new JSDOM(html);
    return dom.window.document;
}

async function getMainBoardCards(document) {
    const cardLINodes = document.querySelectorAll('li.member[id^="boardContainer-main"]');

    if (!cardLINodes || !cardLINodes.length) {
        throw new Error("Cannot find cards")
    }

    const cardLIs = [];
    cardLINodes.forEach(card =>
        cardLIs.push(card)
    );

    const results = [];

    for (const card of cardLIs) {
        const result = await createCardObject(card);

        results.push(result);
    }

    return results
}

async function createCardObject(card) {
    const cardAElement = card.querySelector('a[data-qty]');

    const name = cardAElement.getAttribute('data-name')

    const quantity = parseInt(cardAElement.getAttribute('data-qty'), 10)


    if (!cardAElement || !name || !quantity) {
        throw new Error("invalid card data")
    }

    const images = await getCardImages(name)


    return {
        name,
        quantity,
        ...images
    };
}

function imageSearchUrl(cardName) {

    return `${imageApi}${cardName.replace(/ /g, '+')}`

}

function getImagesFromCardData(cardData) {

    let images = {}

    if (cardData.card_faces && cardData.card_faces.length > 1 && cardData.card_faces[0].image_uris && cardData.card_faces[1].image_uris) {
        images.front = cardData.card_faces[0].image_uris.large
        images.back = cardData.card_faces[1].image_uris.large
    } else {
        images.front = cardData.image_uris.large
        images.back = null
    }

    return images

}

async function getCardImages(cardName) {

    const imageDataResponse = await axios.get(imageSearchUrl(cardName))

    return getImagesFromCardData(imageDataResponse.data)
}

async function getCommander(document) {

    let commander
    const h3Elements = document.querySelectorAll("h3");

    let targetA = getCommanderAElement(h3Elements)

    if (targetA) {
        commander = await createCommanderObject(targetA)
    } else {
        console.log("No commander card found")
    }

    return commander

}

function getCommanderAElement(h3Elements) {
    let targetA = null;

    for (let h3 of h3Elements) {
        if (h3.textContent.includes("Commander")) {
            let next = h3.nextElementSibling;
            while (next && !targetA) {
                const aTag = next.querySelector("a");
                if (aTag) {
                    targetA = aTag;
                    break;
                }
                next = next.nextElementSibling;
            }
            break;
        }
    }

    return targetA
}

async function createCommanderObject(aElement) {
    const name = aElement.getAttribute('data-name')

    if (!name) {
        throw new Error("Error getting commander info")
    }
    const images = await getCardImages(name)

    return {
        name,
        ...images
    }
}

function getTokens(document) {

    const tokens = []

    const deckDetails = document.querySelector("#deck-details")

    const tokenElements = deckDetails?.querySelectorAll(".card-token a")

    if (tokenElements) {
        tokenElements.forEach(token => {

            const imageUrl = token.getAttribute("data-image").includes("https://") ? token.getAttribute("data-image") : `https:${token.getAttribute("data-image")}`
            tokens.push({
                name: token.textContent?.replace(/[\r\n\t]+/g, ' '),
                front: imageUrl
            })
        })
    }

    return tokens

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

    const createPile = (cards, pipeNumber, options = { faceUp: false, useBack: false }) => {

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
            ContainedObjects: containedObjects,
            DeckIDs: deckIDs,
            CustomDeck: customDeck,
            Transform: transform
        };
    }

    const createSingleCardPipe = (card, pipeNumber) => {
        const customDeck = createCustomDeckEntry(card, 1);

        return {
            Name: "Card",
            CustomDeck: customDeck,
            CardID: 100,
            Nickname: card.name,
            Transform: createTransform(pipeNumber, true)
        };
    }

    deck.ObjectStates.push(createPile(deckData.mainBoard, pileNumber++));
    deck.ObjectStates.push(createSingleCardPipe(deckData.commander, pileNumber++));
    deck.ObjectStates.push(createPile(deckData.tokens, pileNumber++, { faceUp: true }));

    const cardsWithBacks = deckData.mainBoard.filter(card => card.back);

    if (cardsWithBacks.length > 0) {
        deck.ObjectStates.push(createPile(cardsWithBacks, pileNumber++, { faceUp: true, useBack: true }));

    }

    return deck;
}

module.exports = {
    generateDeckJson
};