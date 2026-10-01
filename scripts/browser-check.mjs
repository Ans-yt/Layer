import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const baseUrl = process.env.LAYER_E2E_URL || 'http://127.0.0.1:8787/'
const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const screenshotDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screenshots')
await fs.mkdir(screenshotDir, { recursive: true })

const browser = await chromium.launch({ headless: true, executablePath: chrome })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

try {
  await page.goto(`${baseUrl}?skipTour=1`, { waitUntil: 'networkidle' })
  await page.screenshot({ path: path.join(screenshotDir, 'browser-desktop.png') })
  await assertText(page, 'Layer workspace')
  await assertText(page, 'Make the next layer obvious.')

  const title = page.getByText('Hero title', { exact: true })
  await page.locator('.layer-name').filter({ hasText: /^Hero title$/ }).first().click()
  await assertText(page, 'Layout')
  await page.getByRole('button', { name: 'Duplicate' }).click()
  await assertText(page, 'Duplicated 1 layer')

  const titleBox = await title.boundingBox()
  assert.ok(titleBox, 'hero title is rendered on the canvas')
  await page.mouse.click(titleBox.x + 30, titleBox.y + 30, { button: 'right' })
  await assertText(page, 'Ask Layer')
  await page.mouse.click(titleBox.x + 260, titleBox.y + 30)
  assert.equal(await page.locator('.context-menu').count(), 0, 'outside left click closes the context menu')
  await page.mouse.click(titleBox.x + 30, titleBox.y + 30, { button: 'right' })
  await assertText(page, 'Ask Layer')
  await page.getByRole('button', { name: /Ask Layer/ }).last().click()
  await assertText(page, 'Layer AI')

  await page.getByRole('button', { name: 'Select (V)', exact: true }).click()
  const canvas = page.locator('.canvas-viewport')
  const canvasBox = await canvas.boundingBox()
  assert.ok(canvasBox, 'canvas viewport is rendered')
  await page.mouse.move(canvasBox.x + 80, canvasBox.y + 700)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(canvasBox.x + 220, canvasBox.y + 790)
  await page.mouse.up({ button: 'right' })
  await page.screenshot({ path: path.join(screenshotDir, 'browser-right-drag.png') })

  await page.getByRole('button', { name: 'Ask Layer' }).first().click()
  await assertText(page, 'Layer AI')
  const composer = page.getByRole('textbox', { name: 'Ask Layer' })
  await composer.fill('Make this 10% larger')
  await page.getByRole('button', { name: 'Send to Layer AI' }).click()
  await page.waitForTimeout(450)
  await assertText(page, 'Proposed edit')
  await page.getByRole('button', { name: 'Apply change' }).click()
  await assertText(page, 'Applied as one undoable document change.')

  await page.getByRole('button', { name: 'Connections', exact: true }).click()
  await page.locator('.right-panel.panel-connections').waitFor({ state: 'visible' })
  await assertText(page, 'Connections')
  await page.locator('.connections-panel .panel-tabs button').nth(1).click()
  await assertText(page, 'Streamable HTTP MCP')
  await page.locator('.layer-name').filter({ hasText: /^Hero title$/ }).first().click()
  assert.equal(await page.locator('.right-panel.panel-inspector').count(), 1, 'selecting a layer returns to the inspector')
  await assertText(page, 'Text & typography')

  await page.getByRole('button', { name: 'Review & settings' }).click()
  await assertText(page, 'Checks & handoff')
  await page.getByRole('button', { name: 'Run checks' }).click()
  await page.waitForTimeout(450)
  await assertText(page, 'Review the build')
  assert.equal(await page.locator('.issue-row').filter({ hasText: 'Open canvas' }).count(), 0, 'button contrast is not falsely flagged')

  await page.getByRole('button', { name: 'Preview', exact: true }).first().click()
  await page.locator('.preview-experience').waitFor({ state: 'visible' })
  assert.equal(await page.locator('.preview-experience .left-rail, .preview-experience .pages-sidebar, .preview-experience .right-panel, .preview-experience .floating-tool-dock').count(), 0, 'preview hides editor chrome')
  await page.locator('.preview-experience').getByRole('button', { name: 'Open canvas', exact: true }).click()
  await assertText(page, 'Layer Library')
  await page.getByRole('button', { name: 'Exit preview' }).click()
  await assertText(page, 'Library')
  await page.screenshot({ path: path.join(screenshotDir, 'browser-preview.png') })

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).first().click()
  const download = await downloadPromise
  assert.match(download.suggestedFilename(), /\.layer\.zip$/)

  await page.reload({ waitUntil: 'networkidle' })
  await assertText(page, 'Library')

  await page.getByRole('button', { name: 'Quick tour' }).click()
  await assertText(page, 'Layer in about a minute')
  await page.getByRole('button', { name: 'Skip tour' }).click()

  const mobile = await context.browser().newPage()
  await mobile.setViewportSize({ width: 540, height: 780 })
  await mobile.goto(`${baseUrl}?skipTour=1`, { waitUntil: 'networkidle' })
  await mobile.screenshot({ path: path.join(screenshotDir, 'browser-mobile.png') })
  assert.equal(await mobile.locator('.pages-sidebar').isVisible(), false, 'pages sidebar collapses on narrow viewport')
  await mobile.close()

  assert.deepEqual(errors, [], `browser page errors: ${errors.join('; ')}`)
  console.log('browser workflow passed: editor, AI local proposal/apply, connections, checks, preview, tutorial, narrow viewport')
} finally {
  await browser.close()
}

async function assertText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 5000 })
}
