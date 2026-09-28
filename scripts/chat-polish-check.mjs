import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chromium } from 'playwright'

const url = process.env.LAYER_E2E_URL || 'http://127.0.0.1:8787/'
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' })
const errors = []
await fs.mkdir('screenshots/chat-polish', { recursive: true })

async function checkTooltip(page, text) {
  const tip = page.getByRole('tooltip')
  await tip.waitFor({ state: 'visible', timeout: 5000 })
  assert.ok((await tip.textContent()).includes(text))
  const bounds = await tip.boundingBox()
  const viewport = page.viewportSize()
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height, 'tooltip stays inside the viewport')
  assert.equal(await tip.evaluate((node) => node.parentElement === document.body), true, 'tooltip escapes sidebar clipping')
}

try {
  for (const [name, width, height] of [['desktop', 1440, 900], ['compact', 1024, 780], ['narrow', 540, 780]]) {
    const context = await browser.newContext({ viewport: { width, height } })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    // Isolated profile and read-only fixtures: never expose or test saved keys.
    await page.route('**/api/providers', (route) => route.fulfill({ json: { providers: [] } }))
    await page.route('**/api/connections', (route) => route.fulfill({ json: { connections: [] } }))
    await page.goto(`${url}?skipTour=1`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Ask Layer', exact: true }).first().click()
    const composer = page.getByRole('textbox', { name: 'Ask Layer', exact: true })
    const settings = page.getByRole('button', { name: 'AI settings', exact: true })
    await composer.fill('Keep the navigation compact, with **clear labels**.')
    const background = await settings.evaluate((el) => getComputedStyle(el).backgroundColor)
    await settings.hover()
    await checkTooltip(page, 'AI parameters')
    assert.notEqual(await settings.evaluate((el) => getComputedStyle(el).backgroundColor), background, 'hover is visibly different')
    assert.equal(await settings.getAttribute('title'), null)
    assert.ok(await settings.getAttribute('aria-describedby'))
    await page.screenshot({ path: `screenshots/chat-polish/${name}-chat.png` })

    await page.getByRole('button', { name: 'Prompt details', exact: true }).click()
    await settings.click()
    const back = page.getByRole('button', { name: 'Back to Layer AI', exact: true })
    await back.waitFor({ state: 'visible' })
    assert.equal(await page.getByRole('heading', { name: 'Connections', exact: true }).isVisible(), true)
    assert.equal(await page.getByRole('tooltip').count(), 0)
    assert.equal(await page.locator('.connections-panel').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, 'parameters fit sidebar width')
    await page.screenshot({ path: `screenshots/chat-polish/${name}-parameters.png` })
    await page.locator('.connections-panel').evaluate((el) => { el.scrollTop = el.scrollHeight })
    await back.click()
    assert.equal(await composer.inputValue(), 'Keep the navigation compact, with **clear labels**.')
    assert.equal(await page.locator('.prompt-preview').isVisible(), true)
    assert.equal(await settings.evaluate((el) => document.activeElement === el), true, 'focus returns to parameters trigger')
    await page.getByRole('button', { name: 'Hide prompt', exact: true }).click()

    // Keyboard hints and Escape work without stealing unrelated actions.
    await page.getByRole('button', { name: 'Capture canvas', exact: true }).focus()
    await page.keyboard.press('Tab')
    await checkTooltip(page, 'AI parameters')
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('tooltip').count(), 0)
    assert.equal(await page.getByRole('heading', { name: 'Layer AI', exact: true }).isVisible(), true)
    await page.keyboard.press('Enter')
    await back.waitFor({ state: 'visible' })
    await page.keyboard.press('Enter')
    assert.equal(await composer.inputValue(), 'Keep the navigation compact, with **clear labels**.')

    await page.getByRole('button', { name: 'Attach reference', exact: true }).hover()
    await checkTooltip(page, 'Attach a reference')
    await page.getByRole('button', { name: 'Send to Layer AI', exact: true }).hover()
    await checkTooltip(page, 'Send message')
    await page.getByRole('button', { name: 'Ask Layer', exact: true }).first().hover()
    await checkTooltip(page, 'Ask Layer')
    assert.equal(await page.locator('.layer-app button[title]').count(), 0, 'active editor buttons no longer use native title tooltips')
    await context.close()
  }
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`)
  console.log('Chat polish passed at 1440, 1024 and 540px: return navigation, draft retention, focus, sticky back button, hover styles, unclipped mouse/keyboard tooltips.')
} finally { await browser.close() }
