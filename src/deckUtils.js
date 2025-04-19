const { JSDOM } = require('jsdom');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cardCache = path.join(__dirname, '..', 'card-cache.json');

const deckUrlRoot = process.env.DECK_URL_ROOT;

const SLEEP_VALUE = 5000;
const COOLDOWN_VALUE = 3000 * 60;

let requestCount = 0;
let imageCache = {};

const headers = {
	"User-Agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:137.0) Gecko/20100101 Firefox/137.0",
};

async function generateDeckJson(input) {

	await loadCache();

	const deckData = await getDeckData(input);

	const deckJson = convertToTableTop(deckData);

	resetRequestCount();

	return deckJson;
}

function resetRequestCount() {
	sleep(COOLDOWN_VALUE).then(() => {
		requestCount = 0;
	});
}
function loadCache() {
	return new Promise((resolve, reject) => {
		fs.readFile(cardCache, 'utf8', (err, data) => {
			if (err) {
				console.error('Error reading card cache file');
				reject(err);
			} else {
				try {
					imageCache = JSON.parse(data);
					resolve();
				} catch (parseError) {
					console.error('Error parsing JSON');
					reject();
				}
			}
		});
	});
}

function addToCache(url, images) {
	imageCache[url] = images

	fs.writeFile(cardCache, JSON.stringify(imageCache, null, 2), (writeErr) => {
		if (writeErr) {
			console.error('Error saving card cache.');
		}
	});
}

async function getDeckData(deckUrl) {

	const deckRequest = await getPage(deckUrl)

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

	const cardSlug = cardAElement.getAttribute('data-slug')

	const name = cardAElement.getAttribute('data-name')

	const quantity = parseInt(cardAElement.getAttribute('data-qty'), 10)


	if (!cardAElement || !cardSlug || !name || !quantity) {
		throw new Error("invalid card data")
	}

	const cardUrl = `${deckUrlRoot}/mtg-card/${cardSlug}`

	const images = await getCardImages(cardUrl)


	return {
		name,
		quantity,
		...images
	};
}

async function getCardImages(cardUrl) {

	if (imageCache[cardUrl]) {
		return imageCache[cardUrl]
	}

	const { url, dom } = await getImageData(cardUrl)

	const cardBackUrl = getCardBackUrl(dom)

	let backImageUrl

	if (cardBackUrl) {
		const backData = await getImageData(cardBackUrl)
		backImageUrl = backData.url
	}

	const images = {
		front: url,
		back: backImageUrl
	}

	addToCache(cardUrl, images)

	return images

}

async function getImageData(cardUrl) {
	const cardRequest = await getPage(cardUrl)

	const cardDom = getDocumentForHtml(cardRequest.data)

	const imageMeta = cardDom.querySelector('meta[property="og:image"]')

	const contentAttribute = imageMeta.getAttribute("content")

	const imageUrl = contentAttribute.includes("https://") ? contentAttribute : `https:${contentAttribute}`

	return {
		url: imageUrl,
		dom: cardDom
	}

}


function getCardBackUrl(document) {

	let url
	const headings = [...document.querySelectorAll("h4")];
	const backHeading = headings.find(h => h.textContent.trim() === "Back:" || h.textContent.trim() === "Front:");

	if (backHeading) {

		let next = backHeading?.nextElementSibling;
		let link = null;

		while (next && !link) {
			link = next.querySelector?.('a') || null;
			next = next.nextElementSibling;
		}

		if (link) {
			url = `${deckUrlRoot}/${link.getAttribute("data-url")}`
		}
	}

	return url
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
	const cardRelativeUrl = aElement.getAttribute('data-url')

	if (!name || !cardRelativeUrl) {
		throw new Error("Error getting commander info")
	}
	const cardUrl = `${deckUrlRoot}${cardRelativeUrl}`

	const images = await getCardImages(cardUrl)

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


function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function getPage(url) {

	console.log("getting " + url)

	const response = await getRequest(() => axios.get(url, {
		headers,
	}))

	return response
}


async function getRequest(request) {
	requestCount++

	if (requestCount > 50) {
		console.log("Sleeping for cooldown")
		await sleep(COOLDOWN_VALUE)
		requestCount = 0
	}

	let attempt = 0

	while (attempt < 5) {
		try {
			const response = await request()
			requestCount++
			await sleep(SLEEP_VALUE)
			return response
		} catch (e) {
			if (e.response?.status == 429) {
				console.log("Rate limited, sleeping")
			} else {
				console.log("error occured, sleeping")
				throw e
			}
			await sleep(COOLDOWN_VALUE)
			requestCount = 0
		}
		attempt++
	}

	throw new Error("Too many attempts getting data")
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
		const containedObjects = cards.map((card, i) => createContainedObjectsEntry(card, 100 * (i + 1)));
		const deckIDs = containedObjects.map(obj => obj.CardID);

		let i = 1;

		for (const card of cards) {
			Object.assign(customDeck, createCustomDeckEntry(card, i++, options.useBack));
		}

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