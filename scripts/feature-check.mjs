import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const baseUrl = process.env.LAYER_E2E_URL || 'http://127.0.0.1:8787/'
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

try {
  await page.goto(`${baseUrl}?skipTour=1`, { waitUntil: 'networkidle' })

  // Themes: the six presets are selectable in parameters and remain chrome-only.
  await page.getByRole('button', { name: 'Connections', exact: true }).click()
  await page.getByRole('button', { name: 'Themes', exact: true }).click()
  const themes = page.locator('[role="radio"]')
  assert.equal(await themes.count(), 6, 'six theme presets are present')
  await page.getByRole('radio', { name: /Deep Blue/ }).click()
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'deep-blue')
  await page.getByRole('button', { name: 'Back to Layer AI', exact: true }).click()

  // Marketplace rows have usable previews, not text-only install lines.
  await page.getByRole('button', { name: 'Assets & components', exact: true }).click()
  await page.getByRole('tab', { name: 'Marketplace', exact: true }).click()
  await page.getByRole('button', { name: 'Starters', exact: true }).click()
  await page.locator('.catalog-row').first().waitFor({ state: 'visible', timeout: 10000 })
   assert.ok(await page.locator('.catalog-preview').count() > 0, 'marketplace preview thumbnails render')
   assert.ok(await page.getByRole('button', { name: 'Install' }).count() > 0, 'marketplace install remains available')

   // Library shape presets and the bundled project logo create normal editable layers.
   await page.getByRole('tab', { name: 'Library', exact: true }).click()
   await page.getByRole('button', { name: 'Triangle', exact: true }).click()
   assert.equal(await page.locator('[data-shape-visual="triangle"]').count(), 1, 'triangle preset renders as a vector shape')
   await page.getByRole('button', { name: 'Assets & components', exact: true }).click()
   await page.getByRole('tab', { name: 'Library', exact: true }).click()
   await page.getByRole('button', { name: 'Layer logo', exact: true }).click()
   assert.equal(await page.locator('.canvas-element.element-image.selected').count(), 1, 'bundled logo is an editable image layer')
   assert.equal(await page.getByRole('checkbox', { name: 'Lock ratio', exact: true }).isChecked(), true, 'logo keeps its aspect ratio by default')

   // Color picker: open it from the real inspector and update its HEX value.
  await page.goto(`${baseUrl}?skipTour=1`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Select (V)', exact: true }).click()
  await page.getByText('Hero title', { exact: true }).first().click()
  const inspectorSections = (await page.locator('.right-panel .inspector-section-title').allTextContents()).map((text) => text.trim())
  assert.equal(inspectorSections[0], 'Text & typography', 'text layers lead with text controls')
  assert.ok(inspectorSections.indexOf('Layout') > inspectorSections.indexOf('Text & typography'), 'geometry follows text controls')
  assert.ok(await page.getByRole('textbox', { name: 'Visible text', exact: true }).count() > 0, 'visible text editor is immediately available')
  const fillPicker = page.getByRole('button', { name: 'Fill color', exact: true })
  await fillPicker.click()
  await page.getByRole('dialog', { name: 'Fill color picker', exact: true }).waitFor()
  const hex = page.getByRole('textbox', { name: 'Fill value', exact: true })
  await hex.fill('#123456')
  assert.equal(await hex.inputValue(), '#123456')
   await page.getByRole('button', { name: 'HSL', exact: true }).click()
   await hex.fill('210, 50%, 20%')
   await hex.press('Enter')
   assert.match(await hex.inputValue(), /^hsl\(21\d 50% 20%(?: \/ 0%)?\)$/)
   await page.getByRole('button', { name: 'RGB', exact: true }).click()
   assert.match(await hex.inputValue(), /^rgb\(\d+ \d+ \d+(?: \/ 0%)?\)$/)
  await page.keyboard.press('Escape')

  // Cut tool: Ctrl/Cmd+C on one selected item opens the literal chamfer editor.
  await page.getByText('Hero title', { exact: true }).first().click()
  await page.keyboard.press('Control+c')
  await page.getByRole('heading', { name: 'Cut the corners', exact: true }).waitFor()
  assert.ok(await page.getByRole('button', { name: 'Mirror X', exact: true }).count())
  assert.ok(await page.getByRole('button', { name: 'Snap 4px', exact: true }).count())
  const cutField = page.locator('.cut-editor input[type="number"]').first()
  await cutField.fill('24')
  await cutField.press('Enter')
  assert.ok(await page.locator('[data-element-id="hero-title"] .element-content').getAttribute('style').then((style) => style?.includes('clip-path')))
  await page.getByRole('button', { name: 'Close cut editor', exact: true }).click()

  // Shortcuts are modal: Escape closes the modal and never reaches canvas actions.
  const selectedBeforeShortcuts = await page.locator('.selection-count').textContent()
  await page.getByRole('button', { name: 'Shortcuts', exact: true }).click()
  const textCountBeforeModal = await page.locator('.layer-name').filter({ hasText: /^Text$/ }).count()
  await page.keyboard.press('t')
  assert.equal(await page.locator('.layer-name').filter({ hasText: /^Text$/ }).count(), textCountBeforeModal, 'modal pauses canvas shortcuts')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.shortcuts-modal').count(), 0, 'Escape closes shortcuts modal')
  assert.equal(await page.locator('.selection-count').textContent(), selectedBeforeShortcuts, 'Escape preserves the selection')

  // Text tool shortcut and inline editing.
  await page.locator('.layer-app').focus()
  await page.keyboard.press('t')
  const createdText = page.locator('.layer-name').filter({ hasText: /^Text$/ }).last()
  await createdText.waitFor()
  const canvasText = page.locator('.canvas-element.element-text').last()
  await canvasText.dblclick()
  const editor = page.getByRole('textbox', { name: 'Edit Text', exact: true })
  await editor.waitFor()
  await editor.fill('Inline edit works')
  await editor.press('Control+Enter')
  await page.locator('.canvas-element.element-text').filter({ hasText: 'Inline edit works' }).first().waitFor()

  // Review uses the same resolved foreground as the canvas for contrast.
  await page.getByRole('button', { name: 'Review page', exact: true }).click()
  await page.getByRole('button', { name: 'Run checks', exact: true }).click()
  await page.waitForTimeout(260)
  assert.equal(await page.locator('.issue-row').filter({ hasText: 'Open canvas' }).count(), 0, 'button contrast is not falsely flagged')

  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`)
  console.log('Feature check passed: themes, marketplace previews, color picker, cut corners, text shortcut, and inline editing.')
} finally { await browser.close() }
