require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { initDb } = require('./db/schema');
const { validateEnv } = require('./config');
const { seed } = require('./db/seed');

const app = express();

function parseAllowedOrigins() {
  const values = [process.env.FRONTEND_URLS, process.env.FRONTEND_URL]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set(values)];
}

const allowedOrigins = parseAllowedOrigins();

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);

    const isVercelPreview = /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.vercel\.app$/i.test(origin) || /^https:\/\/.+\.vercel\.app$/i.test(origin);
    if (isVercelPreview) return callback(null, true);

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth requests. Please try again later.' },
});

// API Routes
app.use('/api/auth', authRateLimiter, require('./routes/auth'));
app.use('/api/projects',  require('./routes/projects'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/safety',    require('./routes/safety'));
app.use('/api/progress',  require('./routes/progress'));
app.use('/api/risks',     require('./routes/risks'));
app.use('/api/followups', require('./routes/followups'));
app.use('/api/schedule', require('./routes/schedule'));
app.use('/api/pdf', require('./routes/pdf'));
app.use('/api/handover', require('./routes/handover'));
app.use('/api/qms-form-templates', require('./routes/qmsFormTemplates'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/admin/backup', require('./routes/adminBackup'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '1.4.0', platform: 'SFCC QMS' }));

if (process.env.NODE_ENV === 'production') {
  const staticPath = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(staticPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) res.sendFile(path.join(staticPath, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

async function start() {
  validateEnv();
  initDb();
  await seed();

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`\n🚀 SFCC QMS API running on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/api/health\n`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});

module.exports = app;
