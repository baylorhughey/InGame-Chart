const { chromium } = require('playwright');
const APP_URL = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(APP_URL);
  const r = await p.evaluate(() => FB.Tests.run());
  console.log('engine tests: ' + r.passed + ' passed, ' + r.failed + ' failed');
  (r.results || []).forEach(t => {
    if (!t.ok) console.log('  FAIL ' + t.name + '\n       ' + (t.error || ''));
  });
  if (errs.length) console.log('PAGE ERRORS:\n' + errs.join('\n'));
  await b.close();
  process.exit(r.failed === 0 && !errs.length ? 0 : 1);
})();
