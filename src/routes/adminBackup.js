const express = require('express');
const multer = require('multer');
const { requireAuth, requirePermission } = require('../middleware/auth');
const {
  createFullBackup,
  createProjectBackup,
  summarizeBackup,
  restoreBackup,
} = require('../services/backupService');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const nameOk = /\.json$/i.test(file.originalname || '');
    const mimeOk = ['application/json', 'text/json', 'application/octet-stream'].includes(file.mimetype);
    if (!nameOk && !mimeOk) return cb(new Error('Only JSON backup files are allowed.'));
    return cb(null, true);
  },
});

router.use(requireAuth, requirePermission('admin.backup_restore'));

function safeName(value) {
  return String(value || 'backup').replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').toLowerCase();
}

function sendBackup(res, backup, filename) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json(backup);
}

function readBackupFile(req, res) {
  if (!req.file) {
    res.status(400).json({ error: 'Backup JSON file is required.' });
    return null;
  }
  try {
    return JSON.parse(req.file.buffer.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON backup file.' });
    return null;
  }
}

router.get('/full', (req, res) => {
  const backup = createFullBackup(req.user);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  sendBackup(res, backup, `sfcc-qms-full-backup-${stamp}.json`);
});

router.get('/project/:projectId', (req, res) => {
  const backup = createProjectBackup(req.params.projectId, req.user);
  if (!backup) return res.status(404).json({ error: 'Project not found.' });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return sendBackup(res, backup, `sfcc-qms-project-${safeName(backup.metadata.project_code || backup.metadata.project_id)}-${stamp}.json`);
});


function sanitizeRestoreError(error) {
  return String(error?.message || error || 'Restore operation failed.')
    .replace(/\b(?:[A-Za-z]:)?[\/][^\n\r\t ]+/g, '[path]');
}

function restoreErrorResponse(error, dryRun) {
  const safeReason = sanitizeRestoreError(error);
  return {
    ok: false,
    mode: dryRun ? 'dry_run' : 'restore',
    dry_run: !!dryRun,
    valid: false,
    imported_counts: {},
    skipped_counts: {},
    warning_count: 0,
    error_count: 1,
    warnings: [],
    errors: [`Restore failed safely: ${safeReason}`],
    duplicate_details: [],
    duplicates: [],
    error: `Restore failed safely: ${safeReason}`,
  };
}

function uploadBackup(req, res, next) {
  upload.single('backup')(req, res, (error) => {
    if (!error) return next();
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: error.message || 'Invalid backup upload.' });
  });
}

router.post('/validate', uploadBackup, (req, res) => {
  const payload = readBackupFile(req, res);
  if (!payload) return;
  res.json(summarizeBackup(payload));
});

router.post('/restore', uploadBackup, (req, res) => {
  const payload = readBackupFile(req, res);
  if (!payload) return;
  const dryRun = String(req.body?.dry_run ?? 'true') !== 'false';
  const confirm = String(req.body?.confirm ?? 'false') === 'true';
  if (!dryRun && !confirm) return res.status(400).json({ error: 'Restore import requires confirmation.' });
  try {
    const result = restoreBackup(payload, { dryRun });
    return res.status(result.valid ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json(restoreErrorResponse(error, dryRun));
  }
});

module.exports = router;
