import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load Supabase credentials from .env (VITE_* + optional SUPABASE_SERVICE_ROLE_KEY for teardown).
dotenv.config();

export default defineConfig({
  testDir: './tests',
  // Tenant-isolation signs two users in/out in one file — keep it serial and single-worker
  // so tests never race on the shared real Supabase project.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    headless: false, // headed so Nilesh can watch
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  // Auto-start the dev server for the test run if it isn't already up.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000
  }
});
