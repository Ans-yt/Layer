import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chromium } from 'playwright'

const url = process.env.LAYER_E2E_URL || 'http://127.0.0.1:8787/'
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' })
const failures = []
await fs.mkdir('screenshots/micro-fixes', { recursive: true })

async function checkLayers(page, name) {
  const title = page.locator('.layer-name').filter({ hasText: /^Hero title$/ })
  const copy = page.locator('.layer-name').filter({ hasText: /^Hero copy$/ })
  const copyRow = page.locator('.layer-row').filter({ has: copy })
  const titleRow = page.locator('.layer-row').filter({ has: title })
  await title.click()
  await copyRow.getByRole('button', { name: 'Hide layer', exact: true }).click()
  await copyRow.getByRole('button', { name: 'Show layer', exact: true }).waitFor()
  assert.ok((await titleRow.getAttribute('class')).includes('selected'), 'visibility preserves selection')
  assert.equal((await titleRow.getAttribute('class')).includes('is-hidden'), false, 'previous selection is not hidden')
  assert.ok((await copyRow.getAttribute('class')).includes('is-hidden'), 'clicked row is hidden')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await copyRow.getByRole('button', { name: 'Hide layer', exact: true }).waitFor()
  await copyRow.getByRole('button', { name: 'Lock layer', exact: true }).click()
  await copyRow.getByRole('button', { name: 'Unlock layer', exact: true }).waitFor()
  assert.equal((await titleRow.getAttribute('class')).includes('is-locked'), false, 'previous selection is not locked')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await copyRow.getByRole('button', { name: 'Lock layer', exact: true }).waitFor()

  await title.focus()
  await page.keyboard.press('F2')
  const rename = page.getByRole('textbox', { name: 'Layer name', exact: true })
  await rename.fill('Discard this edit')
  await rename.press('Escape')
  assert.equal(await title.isVisible(), true)
  await page.keyboard.press('F2')
  await rename.fill('Revised hero title')
  await rename.press('Enter')
  await page.getByRole('button', { name: 'Revised hero title', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await title.waitFor()

  await title.click()
  await copy.click({ modifiers: ['Shift'] })
  await page.getByRole('button', { name: 'Group selected layers', exact: true }).click()
  const search = page.getByRole('textbox', { name: 'Find layer', exact: true })
  await search.fill('  hero COPY  ')
  await copy.waitFor()
  assert.equal(await page.locator('.layer-row').count(), 2, 'search shows nested match and its group')
  assert.equal(await page.locator('.layers-help').textContent(), '1 match · includes nested layers')
  await page.screenshot({ path: `screenshots/micro-fixes/${name}-layers.png` })
  await search.press('Escape')
  assert.equal(await search.inputValue(), '')
  assert.equal(await page.locator('.layer-row.selected').count(), 1, 'clearing search does not clear the group selection')
}

async function checkChat(page, name) {
  await page.getByRole('button', { name: 'Ask Layer', exact: true }).first().click()
  const selected = page.locator('.canvas-element.selected').first()
  const before = await selected.count() ? await selected.getAttribute('style') : null
  const scope = page.getByRole('combobox', { name: 'AI editing scope' })
  await scope.focus()
  await scope.press('ArrowDown')
  if (before) assert.equal(await selected.getAttribute('style'), before, 'dropdown arrows do not nudge selected layers')
  const assistant = page.locator('.ai-message.assistant').first()
  const text = await assistant.locator('.markdown-body').innerText()
  await assistant.getByRole('button', { name: 'Copy message', exact: true }).click()
  await assistant.getByText('Copied', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text, 'real isolated-browser clipboard receives the message')

  // A native text selection must not be replaced by the editor's layer-copy command.
  await page.evaluate(() => {
    const text = document.querySelector('.ai-message.assistant .markdown-body p')
    const range = document.createRange()
    range.selectNodeContents(text)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
  const selectedText = await page.evaluate(() => window.getSelection().toString())
  await page.keyboard.press('Control+c')
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), selectedText)
  await page.evaluate(() => window.getSelection().removeAllRanges())
  await page.getByRole('textbox', { name: 'Ask Layer', exact: true }).fill('Small details, fewer interruptions.')
  await page.screenshot({ path: `screenshots/micro-fixes/${name}-chat.png` })
}

try {
  for (const [name, width, height] of [['desktop', 1440, 900], ['compact', 1024, 780], ['narrow', 540, 780]]) {
    const context = await browser.newContext({ viewport: { width, height } })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin })
    const page = await context.newPage()
    page.on('pageerror', (error) => failures.push(`${name}: ${error.message}`))
    // No provider requests or credentials: this is local interaction coverage.
    await page.route('**/api/providers', (route) => route.fulfill({ json: { providers: [] } }))
    await page.route('**/api/connections', (route) => route.fulfill({ json: { connections: [] } }))
    try {
      await page.goto(`${url}?skipTour=1`, { waitUntil: 'networkidle' })
      await page.locator('.project-name').click()
      await page.getByRole('button', { name: 'Rename current project', exact: true }).click()
      const projectName = page.getByRole('textbox', { name: 'Project name', exact: true })
      await projectName.fill('  ')
      await projectName.press('Enter')
      assert.equal((await page.locator('.project-name').innerText()).trim(), 'Layer workspace')
      await page.locator('.project-name').click()
      await page.getByRole('button', { name: 'Rename current project', exact: true }).click()
      await projectName.fill('Layer · a deliberately long project name to check truncation')
      await projectName.press('Enter')
      if (width <= 1200) assert.equal(await page.locator('.topbar-center').isVisible(), false, 'compact header does not overlap the tool buttons')
      assert.equal(await page.locator('.canvas-toolbar').evaluate((toolbar) => {
        const bounds = toolbar.getBoundingClientRect()
        return [...toolbar.querySelectorAll('button, select')].every((control) => {
          const box = control.getBoundingClientRect()
          return box.left >= bounds.left && box.right <= bounds.right && box.bottom <= bounds.bottom
        })
      }), true, 'canvas controls wrap instead of clipping')
      await page.locator('.project-name').click()
      const projects = page.getByRole('region', { name: 'Projects', exact: true })
      await projects.waitFor()
      await page.screenshot({ path: `screenshots/micro-fixes/${name}-projects.png` })
      const bounds = await projects.boundingBox()
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'project picker stays inside the viewport')
      assert.equal(await projects.evaluate((panel) => {
        const rect = panel.getBoundingClientRect()
        return panel.contains(document.elementFromPoint(rect.right - 10, rect.bottom - 10))
      }), true, 'project picker is not covered by the inspector')
      await page.locator('.saved-project-list button.current').click()
      assert.equal(await projects.count(), 0)
      assert.ok((await page.locator('.project-name').innerText()).includes('deliberately long project name'), 'current project click preserves the unsaved name')
      await page.locator('.project-name').click()
      await page.keyboard.press('Escape')
      assert.equal(await projects.count(), 0)
      assert.equal(await page.locator('.project-name').evaluate((el) => el === document.activeElement), true)

      const more = page.getByRole('button', { name: 'More export options', exact: true })
      await more.click()
      assert.equal(await page.getByRole('link', { name: 'Open editor in new tab' }).getAttribute('rel'), 'noopener noreferrer')
      await page.locator('.brand-mark').click()
      assert.equal(await page.locator('.export-menu').count(), 0, 'outside click closes file menu')
      await more.click()
      await page.keyboard.press('Escape')
      assert.equal(await more.evaluate((el) => el === document.activeElement), true)
      assert.equal(await more.getAttribute('aria-expanded'), 'false')

      if (width > 650) await checkLayers(page, name)
      await checkChat(page, name)
      console.log(`${name}: toolbar, rename, layer actions/search, copy, and keyboard checks passed`)
    } catch (error) {
      failures.push(`${name}: ${error.message}`)
      await page.screenshot({ path: `screenshots/micro-fixes/${name}-failure.png` })
    } finally { await context.close() }
  }
  assert.deepEqual(failures, [], failures.join('\n'))
  console.log('Three-pass refinements passed at 1440, 1024 and 540px. No live providers used.')
} finally { await browser.close() }
