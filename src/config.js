const crypto = require('crypto');

const DEFAULT_FRONTEND_URL = 'https://sfcc-qms-frontend-7ridiz22m-wp-logical-s-projects.vercel.app';

function validateEnv() {
  const warnings = [];

  if (!process.env.JWT_SECRET || !process.env.JWT_SECRET.trim()) {
    process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
    warnings.push('JWT_SECRET was not set; generated a temporary secret for this process. Set a stable JWT_SECRET in Render to keep tokens valid across restarts.');
  }

  if (!process.env.FRONTEND_URL || !process.env.FRONTEND_URL.trim()) {
    process.env.FRONTEND_URL = DEFAULT_FRONTEND_URL;
    warnings.push(`FRONTEND_URL was not set; using ${DEFAULT_FRONTEND_URL}.`);
  }

  if (warnings.length > 0) {
    console.warn(`[config] ${warnings.join(' ')}`);
  }
}

module.exports = { validateEnv };
