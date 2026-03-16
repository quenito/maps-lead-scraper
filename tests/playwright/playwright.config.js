// @ts-check
const { defineConfig } = require('@playwright/test');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '../../');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  retries: 0,
  workers: 1, // Extensions require serial execution — shared browser state
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/html' }],
  ],
  outputDir: 'test-results/artifacts',
  use: {
    headless: false, // MV3 extensions require headed Chrome (--headless=new handled in fixture)
    viewport: { width: 1280, height: 900 },
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: {
        browserName: 'chromium',
        channel: undefined, // Use system Chrome via fixture
      },
    },
  ],
});
