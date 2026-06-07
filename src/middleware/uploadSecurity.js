const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const BLOCKED_EXTENSIONS = new Set(['.exe', '.bat', '.cmd', '.sh', '.js', '.mjs', '.html', '.php', '.dll', '.msi', '.zip', '.rar']);

const UPLOAD_SECURITY_RULES = {
  documents: {
    maxFileSize: 50 * 1024 * 1024,
    maxFiles: 10,
    allowedExtensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.jpg', '.jpeg', '.png', '.webp'],
    allowedMimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/csv',
      'image/jpeg',
      'image/png',
      'image/webp',
    ],
  },
  handover: {
    maxFileSize: 50 * 1024 * 1024,
    maxFiles: 10,
    allowedExtensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.jpg', '.jpeg', '.png', '.webp'],
    allowedMimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/csv',
      'image/jpeg',
      'image/png',
      'image/webp',
    ],
  },
  progressPhotos: {
    maxFileSize: 20 * 1024 * 1024,
    maxFiles: 20,
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  projectLogos: {
    maxFileSize: 5 * 1024 * 1024,
    maxFiles: 1,
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
};

function sanitizeOriginalFilename(filename = 'file') {
  const base = path.basename(filename).replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim();
  return base.slice(0, 180) || 'file';
}

function safeStoredFilename(originalName = 'file') {
  const ext = path.extname(originalName).toLowerCase();
  return `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`;
}

function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function createUploader({ type, destinationDir }) {
  const rules = UPLOAD_SECURITY_RULES[type];
  if (!rules) throw new Error(`Unknown upload rules type: ${type}`);

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      ensureDirectory(destinationDir);
      cb(null, destinationDir);
    },
    filename: (req, file, cb) => cb(null, safeStoredFilename(file.originalname)),
  });

  const fileFilter = (req, file, cb) => {
    file.originalname = sanitizeOriginalFilename(file.originalname);
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();

    if (BLOCKED_EXTENSIONS.has(ext)) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Blocked extension: ${ext}`));
    }
    if (!rules.allowedExtensions.includes(ext) || !rules.allowedMimeTypes.includes(mime)) {
      return cb(new Error(`Unsupported file type: ${ext || 'unknown'}/${mime || 'unknown'}`));
    }
    cb(null, true);
  };

  return multer({
    storage,
    limits: { fileSize: rules.maxFileSize, files: rules.maxFiles },
    fileFilter,
  });
}

function handleUploadError(err, req, res, next) {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large' });
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Too many files' });
    if (err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Unsupported or blocked file type' });
    return res.status(400).json({ error: 'Upload failed', code: err.code });
  }
  if (err.message?.startsWith('Unsupported file type')) return res.status(400).json({ error: err.message });
  return next(err);
}

module.exports = {
  UPLOAD_SECURITY_RULES,
  BLOCKED_EXTENSIONS,
  sanitizeOriginalFilename,
  createUploader,
  handleUploadError,
};
