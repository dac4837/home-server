const { JSDOM } = require('jsdom');
const axios = require('axios');

const deckUrl = "https://tappedout.net/mtg-decks/slime-time-gary-the-snail/"

const SLEEP_VALUE = 5000
const COOLDOWN_VALUE = 2000*60

let requestCount = 0

const headers = {
	"User-Agent":
	  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:137.0) Gecko/20100101 Firefox/137.0",
  };

getDeckData(deckUrl).then((deck) => {
	console.log(deck)
})

async function getDeckData(deckUrl) {

	console.log("trying " + SLEEP_VALUE/1000 + " seconds")

	try {


		const deckRequest = await getRequest(deckUrl)

		const document = getDocumentForHtml(deckRequest.data)
		// const document = getDocumentForHtml(htmlString)

		const mainBoard = await getMainBoardCards(document)

		const tokens = getTokens(document)

		const commander = await getCommander(document)


		return {
			commander,
			mainBoard,
			tokens
		}

	} catch (e) {

		if(e.status == 429) {
			throw new Error("Tapped out rejected requests due to too much trafic")
		} else {
			throw e
		}		
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

		await sleep(SLEEP_VALUE) // don't want to cause rate limiting
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

	const cardUrl = `https://tappedout.net/mtg-card/${cardSlug}`

	const images = await getCardImages(cardUrl)


	return {
		name,
		quantity,
		...images
	};
}

async function getCardImages(cardUrl) {

	const { url, dom } = await getImageData(cardUrl)

	const cardBackUrl = getCardBackUrl(dom)

	let backImageUrl

	if (cardBackUrl) {
		const backData = await getImageData(cardBackUrl)
		backImageUrl = backData.url
	}

	return {
		front: url,
		back: backImageUrl
	}

}

async function getImageData(cardUrl) {
	const cardRequest = await getRequest(cardUrl)

	const cardDom = getDocumentForHtml(cardRequest.data)

	const imageMeta = cardDom.querySelector('meta[property="og:image"]')

	const imageUrl = `http${imageMeta.getAttribute("content")}`

	return {
		url: imageUrl,
		dom: cardDom
	}

}


function getCardBackUrl(document) {

	let url
	const headings = [...document.querySelectorAll("h4")];
	const backHeading = headings.find(h => h.textContent.trim() === "Back:");

	if (backHeading) {

		let next = backHeading?.nextElementSibling;
		let link = null;

		while (next && !link) {
			link = next.querySelector?.('a') || null;
			next = next.nextElementSibling;
		}

		if (link) {
			url = `https://tappedout.net/${link.getAttribute("data-url")}`
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
	const cardUrl = `https://tappedout.net${cardRelativeUrl}`

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
			tokens.push({
				name: token.textContent?.replace(/[\r\n\t]+/g, ' '),
				front: `https:${token.getAttribute("data-image")}`
			})
		})
	}

	return tokens

}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function getRequest(url) {

    requestCount++

    if (requestCount > 51) {
        console.log("Sleeping for cooldown")
        await sleep(COOLDOWN_VALUE)
        requestCount = 0
    }

    let attempt = 0

    while (attempt < 5) {
        try {
            const response = await axios.get(url, {
                headers,
            })
            requestCount++
            await sleep(SLEEP_VALUE)
            return response
        } catch (e) {
            if (e.response.status == 429) {
                console.log("Rate limited, sleeping")
            } else {
                console.log("error occured, sleeping")
                throw e
            }
            await sleep(COOLDOWN_VALUE)
        }
        attempt++
    }

    throw new Error("Too many attempts getting data")

  }