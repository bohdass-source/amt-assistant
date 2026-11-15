// Imported first by every entry point: some modules read env() at import time
// (for example JwtModule.register), so .env has to be loaded before them.
// In Docker there is no file; variables come from compose.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env: use the process environment */
}
