require('dotenv').config()
const express = require('express')
const app = express() // create express app
const path = require('path')
const redirects = require('../redirects.json')
const fs = require('fs')

const port = process.env.PORT
const clientDirectory = path.join(__dirname, '..', 'client')

// files
app.get('/files/:fileName', (req, res) => {
  const filePath = path.join(__dirname, '..', 'files', req.params['fileName'])
  if (fs.existsSync(filePath)) {
    res.download(filePath)
  } else {
    res.status(404).send('File not found')
  }
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

// add all client apps from the clients directory
// fs.readdirSync(clientsDirectory).forEach((directoryName) => {
//   const directory = path.join(clientsDirectory, directoryName)
//   console.log(`Adding ${directory}`)
//   const stats = fs.statSync(directory)
//   if (stats.isDirectory() && fs.existsSync(path.join(directory, 'index.html'))) {
//     app.use(express.static(directory))

//     app.use((req, res, next) => {
//       res.sendFile(path.join(directory, 'index.html'))
//     })
//   }
// })

// client/ui
app.use(express.static(clientDirectory))
app.use((req, res, next) => {
  res.sendFile(path.join(clientDirectory, 'index.html'))
})

// start express server
app.listen(port, () => {
  console.log(`server started on port ${port}`)
})
