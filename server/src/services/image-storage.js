const fs = require('fs');
const path = require('path');
const config = require('../config');

const uploadDir = path.join(__dirname, '..', '..', config.uploadDir);

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

function saveBase64Image(base64Data) {
  const buffer = Buffer.from(base64Data, 'base64');
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const filePath = path.join(uploadDir, filename);
  fs.writeFileSync(filePath, buffer);
  return filename;
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

module.exports = { saveBase64Image, deleteImage, getImagePath };
