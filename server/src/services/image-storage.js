const fs = require('fs');
const path = require('path');
const config = require('../config');
const { createPngThumbnail } = require('./png-thumbnail');

const uploadDir = path.join(__dirname, '..', '..', config.uploadDir);

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

function saveImageBuffer(buffer, extension = '.png') {
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const filePath = path.join(uploadDir, filename);
  fs.writeFileSync(filePath, buffer);
  return {
    filename,
    thumbnail: saveThumbnail(buffer, filename, extension),
  };
}

function saveBase64Image(base64Data) {
  return saveImageBuffer(Buffer.from(base64Data, 'base64'), '.png');
}

function saveThumbnail(buffer, originalFilename, extension = '.png') {
  if (extension.toLowerCase() !== '.png') return null;
  try {
    const thumbnailBuffer = createPngThumbnail(buffer);
    if (!thumbnailBuffer) return null;
    const thumbnailName = `thumb-${originalFilename}`;
    fs.writeFileSync(path.join(uploadDir, thumbnailName), thumbnailBuffer);
    return thumbnailName;
  } catch (err) {
    console.warn('[ImageStorage] thumbnail failed:', err.message);
    return null;
  }
}

function deleteImage(filename) {
  const filePath = path.join(uploadDir, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function getImagePath(filename) {
  return path.join(uploadDir, filename);
}

module.exports = { saveBase64Image, saveImageBuffer, deleteImage, getImagePath };
