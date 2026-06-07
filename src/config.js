const requiredEnvVars = ['JWT_SECRET', 'FRONTEND_URL'];

function validateEnv() {
  const missing = requiredEnvVars.filter((key) => !process.env[key] || !process.env[key].trim());

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

module.exports = { validateEnv };
