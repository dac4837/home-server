require('dotenv').config()
const express = require('express')
const app = express() // create express app
const path = require('path')
const redirects = require('../redirects.json')
const fs = require('fs')

const port = process.env.PORT
const clientDirectory = path.join(__dirname, '..', 'client')

const INVALID_FILE_CHARACTERS = ['..', '/', '\\', '<', '>', '&']

// files
app.get('/files/:fileName', (req, res) => {
  const fileName = eq.params['fileName']

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
