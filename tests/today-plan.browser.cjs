const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { makeBackend, legacy } = require('./helpers/mock-apps-script.cjs');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
  try {
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file.endsWith('/') ? file + 'index.html' : file));
  } catch { res.writeHead(404); res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  try {
    for (const width of [320, 390, 1280]) {
      const backend = makeBackend(legacy); backend.setup();
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage();
      const errors = []; let writes = 0;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.WORKOUT_CONFIG={autoSync:true,defaultBackendUrl:"https://workout-test.invalid/exec"};' }));
      await page.route('https://workout-test.invalid/**', route => {
        const url = new URL(route.request().url());
        const action = url.searchParams.get('action');
        if (action !== 'snapshot') writes++;
        const data = backend.call(action, url.searchParams.get('userId'), JSON.parse(url.searchParams.get('payload') || '{}'));
        return route.fulfill({ contentType: 'text/javascript', body: `${url.searchParams.get('callback')}(${JSON.stringify(data)})` });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => backendReady && !flushingWrites && pendingWrites.length === 0);
      const initialWrites = writes;
      const flag = page.locator('[data-plan-workout="leg-press"]');
      await flag.click();
      assert.equal(await flag.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('[data-detail-panel]').count(), 0);
      await page.reload();
      await page.waitForFunction(() => backendReady && !flushingWrites);
      assert.equal(await flag.getAttribute('aria-pressed'), 'true');
      await flag.click();
      assert.equal(await flag.getAttribute('aria-pressed'), 'false');
      await flag.click();
      await page.evaluate(() => {
        activateProfile('test-profile');
        render();
      });
      assert.equal(await flag.count(), 0);
      assert.deepEqual(await page.evaluate(() => todayPlan()), []);
      await page.evaluate(() => { activateProfile('tal'); render(); });
      assert.equal(await flag.getAttribute('aria-pressed'), 'true');
      assert.equal(writes, initialWrites, 'Planning must not write to backend');
      for (const theme of ['garden', 'tide', 'moon', 'sunrise']) {
        await page.evaluate(theme => { state.settings.theme = theme; render(); }, theme);
        assert.equal(await flag.getAttribute('aria-pressed'), 'true');
        assert(await flag.isVisible());
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (width === 390 || width === 1280) await page.screenshot({ path: `/tmp/workout-plan-${width}-${theme}.png`, fullPage: true });
      }
      await page.evaluate(() => {
        const plan = JSON.parse(localStorage.getItem(PLAN_STORAGE_KEY));
        plan.date = '2000-01-01';
        localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plan)); render();
      });
      assert.equal(await flag.getAttribute('aria-pressed'), 'false');
      await page.locator('[data-open-settings]').click();
      await page.locator('[data-show-planning-flags]').uncheck();
      await page.locator('[data-save-settings]').click();
      assert.equal(await flag.count(), 0);
      await page.reload();
      await page.waitForFunction(() => backendReady && !flushingWrites);
      assert.equal(await flag.count(), 0, 'Hide flags preference persists');
      await page.locator('[data-open-settings]').click();
      await page.locator('[data-show-planning-flags]').check();
      await page.locator('[data-save-settings]').click();
      await page.evaluate(() => {
        for (const offset of [1, 2, 3]) state.logs.push({id: `test-${offset}`, machineId: 'leg-curl', date: addDays(isoDate(new Date()), -offset), createdAt: new Date().toISOString(), weight: '65'});
        render();
      });
      const row = page.locator('[data-machine-row="leg-press"]');
      assert((await row.getAttribute('class')).includes('is-suggested'));
      const yellow = await row.locator('th').evaluate(e => getComputedStyle(e).backgroundColor);
      await flag.click();
      const blue = await row.locator('th').evaluate(e => getComputedStyle(e).backgroundColor);
      assert.notEqual(blue, yellow, 'Blue takes priority over yellow');
      await flag.click();
      assert.equal(await row.locator('th').evaluate(e => getComputedStyle(e).backgroundColor), yellow);
      await flag.click();
      await page.locator('[data-repeat-weight="leg-press"]').click();
      await page.waitForFunction(() => !flushingWrites && pendingWrites.length === 0);
      assert.equal(await flag.count(), 0, 'Completion removes flag control');
      assert(!(await row.getAttribute('class')).includes('is-planned'));
      assert(!(await row.getAttribute('class')).includes('is-suggested'));
      assert.deepEqual(await page.evaluate(() => todayPlan()), []);
      await page.locator('[data-remove-today="leg-press"]').click();
      assert.equal(await flag.getAttribute('aria-pressed'), 'false', 'Undo completion does not revive the plan');
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}: flags toggle, persist, isolate profiles, reset next day, no backend writes, four themes, no page overflow`);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
