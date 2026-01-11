const fs = require('fs');
const fsPromise = require('fs/promises');
const path = require('path');

async function ensureDir(dir) {
  try {
    await fsPromise.mkdir(dir, { recursive: true });
  } catch (err) {
    // mkdir may fail if dir already exists or due to permissions — rethrow for unexpected errors
    if (err.code !== 'EEXIST') throw err;
  }
}

function sanitizeBaseName(name) {
  // keep letters, numbers, dash, underscore, dot, parentheses; replace spaces with underscore
  return name.replace(/\s+/g, '_').replace(/[^\w\-\.()]/g, '') || 'upload';
}

async function saveUploadedFile(file, uploadDir) {
  if (!file) throw new Error('No file provided');

  await ensureDir(uploadDir);

  const originalName = (file.originalFilename || file.originalname || file.newFilename || file.name || '').toString();
  const srcPath = file.filepath || file.path || file.fileupload || null;

  const ext = path.extname(originalName) || path.extname(srcPath || '') || '';
  const baseName = sanitizeBaseName(originalName ? path.basename(originalName, ext) : 'upload');

  const destName = `${baseName}_${Date.now()}${ext}`;
  const destPath = path.join(uploadDir, destName);

  if (!srcPath) {
    const e = new Error('No source path for uploaded file');
    e.file = file;
    throw e;
  }

  await fsPromise.rename(srcPath, destPath);

  return {
    filename: destName,
    path: destPath
  };
}

module.exports = {
  saveUploadedFile,
  sanitizeBaseName
};
