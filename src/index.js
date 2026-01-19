require('dotenv').config()
const express = require('express')
const formidablePkg = require('formidable');
const formidable = formidablePkg.formidable || formidablePkg.default || formidablePkg;
const app = express() // create express app
const path = require('path')
const redirects = require('../redirects.json')
const fs = require('fs')
const fsPromise = require('fs/promises');
const { generateDeckJson } = require('./deckUtils');
const rootDirectory = path.join(__dirname, '..')
const clientDirectory = path.join(rootDirectory, 'client')
const santaClientDirectory = path.join(rootDirectory, 'santa-client')
const messageDirectory = path.join(rootDirectory, process.env.MESSAGE_DIRECTORY)
const deckUrlRoot = process.env.DECK_URL_ROOT

const INVALID_FILE_CHARACTERS = ['..', '/', '\\', '<', '>', '&']

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
    maxFileSize: 100 * 1024 * 1024, // 100MB
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
      const { saveUploadedFile } = require('./uploadUtils');
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

const isValidUrl = (str) => {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
};


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
      if(error.status == 404) {
        res.status(404).send('Deck requires authentication or not found. Please update the deck to be public');
      } else {
        res.status(500).send('Error generating Deck JSON.');
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
  console.log(`server started on port ${port}`)
})

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
