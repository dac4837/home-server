require('dotenv').config()
const express = require('express')
const { body, validationResult } = require('express-validator')
const app = express() // create express app
const path = require('path')
const redirects = require('../redirects.json')
const fs = require('fs')
const fsPromise = require('fs/promises');

const rootDirectort = path.join(__dirname, '..')
const clientDirectory = path.join(rootDirectort, 'client')
const messageDirectory = path.join(rootDirectort, process.env.MESSAGE_DIRECTORY)

const INVALID_FILE_CHARACTERS = ['..', '/', '\\', '<', '>', '&']

const port = process.env.PORT

if(!port) {
  console.error("Need to specify port in .env")
  process.exit(1)
}

if(!process.env.MESSAGE_DIRECTORY) {
  console.error("Need to specify port in .env")
  process.exit(1)
}

//middleware
app.use(express.urlencoded({
  extended: true
}))

// files
app.get('/files/:fileName', (req, res) => {
  const fileName = req.params['fileName']

  if(!isFilePathClean(fileName)) {
    res.status(400).send('Bad file name')
  }

  const filePath = path.join(__dirname, '..', 'files', fileName)
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if(err) {
      res.status(404).send('File not found')
    } else {
      res.download(filePath)
    }
  });
})

// james messages
app.post(
  '/hijames',
  body('name').isLength({ min: 2 }),
  body('message').isLength({ min: 5 }),
  (req, res) => {

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error(errors.array())
      return res.status(400).send("Whoops something went wrong! Did you fill out the message? Click back to continue. Contact David if error persists")
    }

    saveMessage(req.body.name, req.body.message)
      .then(()=>res.redirect(`${req.get('referer')}?success=true`))
      .catch(error => {
        console.error(error.message)
        return res.status(500).send("Whoops something went wrong! We couldn't save that message. Click back to continue. Contact David if error persists")
      });

    },
);

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
    console.log(invalidCharacter)
    if (filePath.includes(invalidCharacter)) isValid = false
  })
  
  return isValid
}

function saveMessage(author, message) {

  const timestamp = Date.now()
  const dateString = (new Date).toLocaleDateString()

  if(author && message) {
    const filename = `james-message-${timestamp}.txt`
    const fileContent = `Author: ${author}\nDate: ${dateString}\n\n${message}`
    
    return fsPromise.writeFile(path.join(messageDirectory, filename), fileContent)
  }
}
