require('dotenv').config()
const express = require('express')
const formidablePkg = require('formidable');
const { GoogleGenAI } = require('@google/genai');
const formidable = formidablePkg.formidable || formidablePkg.default || formidablePkg;
const app = express() // create express app
const path = require('path')
const redirects = require('../redirects.json')
const fs = require('fs')
const fsPromise = require('fs/promises');
const { generateDeckJson, generateDeckJsonFromList } = require('./deckUtils');
const { saveUploadedFile } = require('./uploadUtils');
const rootDirectory = path.join(__dirname, '..')
const clientDirectory = path.join(rootDirectory, 'client')
const santaClientDirectory = path.join(rootDirectory, 'santa-client')
const messageDirectory = path.join(rootDirectory, process.env.MESSAGE_DIRECTORY)
const deckUrlRoot = process.env.DECK_URL_ROOT
const CARD_TITLE_PROMPT = process.env.AI_PROMPT
const AI_SYSTEM_PROMPT = process.env.AI_SYSTEM_PROMPT
const AI_MODEL_NAME = process.env.AI_MODEL_NAME || "gemini-2.5-flash" //https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash
const AI_TEMERATURE = parseFloat(process.env.AI_TEMPERATURE) || 1
const AI_MAX_OUTPUT_TOKENS = parseInt(process.env.AI_MAX_OUTPUT_TOKENS) || 5000
const AI_TOP_P = parseFloat(process.env.AI_TOP_P) || 0.95


const INVALID_FILE_CHARACTERS = ['..', '/', '\\', '<', '>', '&']
const SUPPORTED_IMAGES = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.tif': 'image/tiff',
          '.tiff': 'image/tiff',
          '.heic': 'image/heic',
          '.avif': 'image/avif'
        };

const port = process.env.PORT

if (!port) {
  console.error("Need to specify port in .env")
  process.exit(1)
}

if (!process.env.MESSAGE_DIRECTORY) {
  console.error("Need to specify port in .env")
  process.exit(1)
}

//middleware
app.use(express.urlencoded({
  extended: true
}))
app.use(express.json());

// home
app.get('/', (req, res) => {
  res.send('Nothing to see here...')
})

// files
app.get('/files/:fileName', (req, res) => {
  const fileName = req.params['fileName']

  if (!isFilePathClean(fileName)) {
    res.status(400).send('Bad file name')
  }

  const filePath = path.join(__dirname, '..', 'files', fileName)
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      res.status(404).send('File not found')
    } else {
      res.download(filePath)
    }
  });
})

// upload
app.post('/uploadfile', function (req, res) {
  const form = formidable({
    multiples: false,
    maxFileSize: 20 * 1024 * 1024, // 20MB
    keepExtensions: true,
    uploadDir: path.join(__dirname, '..', 'uploads')
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Upload error:', err);
      return res.status(400).send('Error uploading file');
    }

    let file = files.file;
    if (Array.isArray(file)) file = file[0];
    if (!file) return res.status(400).send('No file uploaded');
    const uploadDir = path.join(__dirname, '..', 'uploads');
    try {

      const result = await saveUploadedFile(file, uploadDir);
      return res.status(200).send({ filename: result.filename });
    } catch (moveErr) {
      console.error('Error saving uploaded file:', moveErr);
      return res.status(500).send('Error saving file');
    }
  });
});

// james messages
app.post('/hijames', (req, res) => {
  const name = req.body && req.body.name;
  const message = req.body && req.body.message;

  const errors = [];
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('Please enter a valid name.');
  }
  if (!message || typeof message !== 'string' || message.trim().length < 5) {
    errors.push('Please provide a message.');
  }

  if (errors.length) {
    return res.status(400).send(errors.join(' '));
  }

  saveMessage(name, message)
    .then(() => res.status(201).send())
    .catch(error => {
      console.error(error && error.message ? error.message : error);
      return res.status(500).send("Whoops something went wrong! We couldn't save that message. Click back to continue. Contact David if error persists");
    });
});

// magic stuff

function isValidUrl(str) {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}


function isImage(str) {
  if (!str || typeof str !== 'string') return false;
  const ext = path.extname(str).toLowerCase();
  return Object.prototype.hasOwnProperty.call(SUPPORTED_IMAGES, ext);
}

async function deleteUploadedFile(filePath) {
  try {
    await fsPromise.unlink(filePath);
  } catch (unlinkErr) {
    console.warn('Failed to delete temporary uploaded file:', unlinkErr);
  }
}

async function parseCardTitlesFromImage(base64Images) {
  let ai;
  try {
    ai = new GoogleGenAI({})
  } catch (initErr) {
    console.error('Error initializing GoogleGenAI client:', initErr);
    throw new Error('AI initialization failed');
  }
  // allow a single base64 string or an array of them
  const images = Array.isArray(base64Images) ? base64Images : [base64Images];

  const inlineItems = images.map(img => {
    let data = '';
    let mimeType = 'image/jpeg';
    if (typeof img === 'string') {
      data = img;
    } else if (img && typeof img === 'object') {
      data = img.data || img.base64 || '';
      mimeType = img.mimeType || img.type || mimeType;
    }
    return {
      inlineData: {
        data,
        mimeType
      }
    };
  });


  console.debug(`${inlineItems.length} images prepared for AI processing`);

  const promptContents = [{role: 'user', parts: [{ text: CARD_TITLE_PROMPT }, ...inlineItems]}];

  try {
    // Send prompt + images to the GenAI models.generateContent endpoint
    const result = await ai.models.generateContent({
      model: AI_MODEL_NAME,
      systemInstruction: AI_SYSTEM_PROMPT,
      config: {
        temperature: AI_TEMERATURE,
        maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
        topP: AI_TOP_P,
        responseMimeType: 'application/json',
        thinking_level: "minimal"
      },
      contents: promptContents
    });

    if (!result) {
      return { cards: [], message: 'No response from AI' };
    }

    if (result.error) {
      return { cards: [], message: JSON.stringify(result.error) };
    }

    let message = '';
    let cards = [];



    // Prefer `result.text` but fall back to candidate content shapes
    let text = result.text;

    if (!text) {
      console.error('No text response from AI model');
      console.error(JSON.stringify(result, null, 2));
      return [];
    }

    try {
      cards = JSON.parse(text);
    } catch (parseErr) {
      message = `Failed to parse card titles from image ${text}`;
    }

    if(result.candidates && result.candidates.length > 0 && result.candidates[0].finishReason && "STOP" !== result.candidates[0].finishReason) {
      message += ` AI response finished with reason: ${result.candidates[0].finishReason}.`;
    }

    console.debug(`AI returned ${cards.length} card titles from image(s)`);

    return { message, cards };

  } catch (aiErr) {
    console.error('Error during AI content generation:', aiErr);
    throw new Error('AI content generation failed');
  }
}


app.get('/magic-json', (req, res) => {
  const deckUrl = req.query.deckUrl;

  const deckBase = `${deckUrlRoot}/mtg-decks`;

  if (!deckUrl || typeof deckUrl !== 'string') {
    return res.status(400).send('Invalid input. deckUrl is required and must be a string.');
  }

  if (!isValidUrl(deckUrl) || !deckUrl.startsWith(deckBase)) {
    return res.status(400).send(`Invalid deckUrl. It must be a valid URL starting with ${deckBase}`);
  }

  generateDeckJson(deckUrl)
    .then((deckJson) => res.json(deckJson))
    .catch((error) => {
      console.error(error.message);
      if (error.status == 404) {
        res.status(404).send('Deck requires authentication or not found. Please update the deck to be public');
      } else {
        res.status(500).send('Error generating Deck JSON.');
      }
    });
});

app.post('/magic-json-from-list', async (req, res) => {

  const cardNames = req.body

  if (!Array.isArray(cardNames) || cardNames.length === 0 || !cardNames.every(name => typeof name === 'string' && name.trim().length > 0)) {
    return res.status(400).send('Invalid input. cardNames must be a non-empty array of strings.');
  }

  try {
    const deckJson = await generateDeckJsonFromList(cardNames);
    return res.json(deckJson);
  } catch (error) {
    console.error('Error generating Deck JSON from list:', error);
    return res.status(500).send('Error generating Deck JSON from list.');
  }

})

//https://ai.google.dev/gemini-api/docs/quickstart
app.post('/magic-json-from-photo', async (req, res) => {
  const form = formidable({
    multiples: true,
    maxFileSize: 20 * 1024 * 1024, // 20MB total
    keepExtensions: true,
    uploadDir: path.join(__dirname, '..', 'magicuploads')
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Error parsing upload form:', err);
      return res.status(400).json({ error: 'Invalid upload' });
    }

    try {
      // gather uploaded files: support fields `photo`, `file`, or `image`
      const uploaded = [];
      const photos = files.photo
      if (Array.isArray(photos)) uploaded.push(...photos); else uploaded.push(photos);

      if (uploaded.length === 0) return res.status(400).json({ error: 'No file uploaded' });

      if (uploaded.length > 3) {
        // cleanup any temp files
        await Promise.all((uploaded || []).map(f => deleteUploadedFile(f.filepath).catch(() => { })));
        return res.status(400).json({ error: 'Maximum 3 images allowed' });
      }

      const base64Images = [];
      savedPaths = [];

      for (const f of uploaded) {
        const srcPath = f.filepath
        if (!srcPath || !isImage(srcPath)) {
          // cleanup all previously saved
          await Promise.all(savedPaths.map(p => deleteUploadedFile(p).catch(() => { })));
          if (srcPath) await deleteUploadedFile(srcPath).catch(() => { });
          return res.status(400).json({ error: 'Uploaded file is not a supported image' });
        }

        const buffer = await fsPromise.readFile(srcPath);
        const ext = path.extname(srcPath).toLowerCase();
        const mimeType = SUPPORTED_IMAGES[ext] || 'image/jpeg';

        base64Images.push({ data: buffer.toString('base64'), mimeType });
        savedPaths.push(srcPath);
      }

      // call helper with array of base64 images (supports single or multiple)
      const { cards, message } = await parseCardTitlesFromImage(base64Images);

      // cleanup all temp files
      await Promise.all(savedPaths.map(p => deleteUploadedFile(p).catch(() => { })));

      let deckJson = null;
      if (cards && Array.isArray(cards) && cards.length > 0) {

        deckJson = await generateDeckJsonFromList(cards);
      }

      return res.json({ message, deckJson, cards });

    } catch (error) {
      console.error('Error processing card image:', error);
      // ensure any temporary uploads are removed
      try {
        await Promise.all((savedPaths || []).map(p => deleteUploadedFile(p).catch(() => { })));
      } catch (_) { }
      return res.status(500).json({ error: 'Failed to process image.' });
    }
  });
});


// custom redirects
redirects.forEach((redirect) => {
  if (redirect.path && redirect.url) {
    app.get(`/${redirect.path}`, (req, res) => {
      res.redirect(redirect.url)
    })
  }
})

app.get('/health', (req, res) => {
  res.send('UP')
})

// santa ui

async function getListForElf(elfId, callback) {

  const filePath = path.join(__dirname, '..', 'elves', `${elfId.toLowerCase()}.json`)

  fs.readFile(filePath, callback);

}
app.get('/elf/:elfId', (req, res) => {
  const elfId = req.params['elfId']

  const filePath = path.join(__dirname, '..', 'elves', 'elves.json')

  fs.readFile(filePath, function (err, data) {

    if (err) {
      res.status(500).send("unexpected error")
    } else {

      const allElves = JSON.parse(data)

      const elves = allElves.filter(e => e.id === elfId)

      if (elves.length > 0) {

        elf = elves[0]

        getListForElf(elf.id, function (err, data) {

          elf.list = err ? [] : JSON.parse(data)

          const santaObjects = allElves.filter(d => d.id === elf.santaTo);

          if (santaObjects.length > 0) {
            elf.santaToObject = santaObjects[0]

            getListForElf(elf.santaToObject.id, function (err2, data2) {

              elf.santaToObject.list = err2 ? [] : JSON.parse(data2)

              res.send(elf)

            })
          } else {
            res.status(500).send("Invalid elf state")
          }

        })

      } else {
        res.status(404).send("elf not found")
      }
    }

  });

})

app.get('/elfList/:elfId', (req, res) => {
  const elfId = req.params['elfId']

  getListForElf(elfId, function (err, data) {

    if (err) {
      res.send([])
    } else {
      res.send(data)
    }

  })

})

app.put('/elfList/:elfId', (req, res) => {
  const elfId = req.params['elfId']

  const data = req.body

  const filePath = path.join(__dirname, '..', 'elves', `${elfId.toLowerCase()}.json`)

  fs.writeFile(filePath, JSON.stringify(data), (error) => {
    if (error) {
      res.status(500).send("unexpected error while saving elf list")
    } else {
      res.send()
    }
  })

})

app.use(express.static(santaClientDirectory))
app.use("/santa", (req, res, next) => {
  res.sendFile(path.join(santaClientDirectory, 'index.html'))
})

// client/ui
app.use(express.static(clientDirectory))
app.use((req, res, next) => {
  res.sendFile(path.join(clientDirectory, 'index.html'))
})

// start express server
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

function isFilePathClean(filePath) {
  if (!filePath) return false

  let isValid = true

  INVALID_FILE_CHARACTERS.forEach(invalidCharacter => {
    if (filePath.includes(invalidCharacter)) isValid = false
  })

  return isValid
}

function saveMessage(author, message) {

  const timestamp = Date.now()
  const dateString = (new Date).toLocaleDateString()

  if (author && message) {
    const filename = `james-message-${timestamp}.txt`
    const fileContent = `Author: ${author}\nDate: ${dateString}\n\n${message}`

    return fsPromise.writeFile(path.join(messageDirectory, filename), fileContent)
  }
}
