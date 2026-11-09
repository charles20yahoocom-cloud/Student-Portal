// Shared profile-image handling.
//
// Security goals:
//  - never trust the browser-supplied MIME type or file extension
//  - never keep the original filename (path traversal / stored XSS via .html)
//  - keep uploads in memory so nothing is written before validation passes
//  - write files with random names that cannot be guessed or used as markup

const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { profileDir: PROFILE_DIR } = require('../config/paths');

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};
const ALLOWED_MIMES = Object.keys(EXT_BY_MIME);

// Read the first bytes and decide what the file really is. Anything that is
// not a real JPEG/PNG/WebP is rejected, whatever the browser claimed.
function detectMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      return cb(new Error('UNSUPPORTED_IMAGE_TYPE'));
    }
    cb(null, true);
  }
});

// Validate + persist an uploaded image. Returns the public URL to store in the DB.
function saveProfileImage(file, prefix = 'profile') {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
    const err = new Error('NO_FILE');
    err.code = 'NO_FILE';
    throw err;
  }

  const detected = detectMime(file.buffer);
  if (!detected || detected !== file.mimetype) {
    const err = new Error('INVALID_IMAGE');
    err.code = 'INVALID_IMAGE';
    throw err;
  }

  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const safePrefix = String(prefix || 'profile').replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'profile';
  const filename = `${safePrefix}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${EXT_BY_MIME[detected]}`;

  fs.writeFileSync(path.join(PROFILE_DIR, filename), file.buffer);
  return `/uploads/profiles/${filename}`;
}

// Delete a previously stored profile image. Only touches files inside
// uploads/profiles, and only names we could have generated.
function removeProfileImage(publicPath) {
  if (!publicPath) return;
  const match = /^\/uploads\/profiles\/([A-Za-z0-9._-]+)$/.exec(String(publicPath));
  if (!match || match[1].includes('..')) return;
  const target = path.join(PROFILE_DIR, match[1]);
  try {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } catch (err) {
    console.error('Could not remove old profile image:', err.message);
  }
}

module.exports = {
  PROFILE_DIR,
  imageUpload,
  saveProfileImage,
  removeProfileImage,
  detectMime
};
