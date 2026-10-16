// Remember App - Test Harness (Playwright edition) v1
// Same job as remember-test-harness-v8.js (jsdom), but drives a REAL Chromium
// via Playwright instead of jsdom, for environments where `npm install jsdom`
// is not possible (e.g. the Claude cloud sandbox, whose proxy blocks npm).
//
// Usage:
//   NODE_PATH=/opt/npm-tools/node_modules node remember-test-harness-pw-v1.js <build.html> <cases.js> <goldens.json>
//   ... <build.html> <cases.js> --update <new-goldens.json>   (never overwrites an existing file)
//
// Ported from harness v8: style/HTML comment balance, settings nesting depth,
// settings-row-in-section, settings search, help search, arming, golden cases.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const APP_URL = 'https://lynn-edu-apps.github.io/everyday-apps/remember/';

function checkStyleCommentBalance(html) {
  const MAX = 40; const problems = [];
  const blocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  blocks.forEach((css, bi) => {
    let inC = false, start = null, line = 1, i = 0;
    while (i < css.length) {
      if (css[i] === '\n') line++;
      if (!inC && css.slice(i, i + 2) === '/*') { inC = true; start = line; i += 2; continue; }
      if (inC && css.slice(i, i + 2) === '*/') {
        if (line - start > MAX) problems.push('style block ' + bi + ': comment spans ' + (line - start) + ' lines');
        inC = false; i += 2; continue;
      }
      if (inC && css.slice(i, i + 2) === '/*') problems.push('style block ' + bi + ': comment opened at line ' + start + ' not closed before another at ' + line);
      i++;
    }
    if (inC) problems.push('style block ' + bi + ': UNCLOSED comment near line ' + start);
  });
  return problems;
}

function checkHtmlCommentBalance(html) {
  const MAX = 400; const problems = [];
  let inC = false, start = null, line = 1, i = 0; const n = html.length;
  while (i < n) {
    if (html[i] === '\n') line++;
    if (!inC && html.slice(i, i + 4) === '<!--') { inC = true; start = line; i += 4; continue; }
    if (inC && html.slice(i, i + 3) === '-->') {
      if (line - start > MAX) problems.push('HTML comment spans ' + (line - start) + ' lines (' + start + '-' + line + ')');
      inC = false; i += 3; continue;
    }
    if (inC && html.slice(i, i + 4) === '<!--') problems.push('comment opened at line ' + start + ' not closed before another at ' + line);
    i++;
  }
  if (inC) problems.push('UNCLOSED HTML comment near line ' + start);
  return problems;
}

function checkSettingsSectionNestingDepth(raw) {
  const problems = [];
  const idx = raw.indexOf('id="settings-sheet"');
  if (idx === -1) return problems;
  const start = raw.lastIndexOf('<div', idx);
  let depth = 0; const found = []; let i = start;
  const limit = Math.min(start + 200000, raw.length);
  while (i < limit) {
    if (raw.slice(i, i + 4) === '<div') {
      depth += 1;
      const end = raw.indexOf('>', i); if (end === -1) break;
      const tag = raw.slice(i, end + 1);
      if (tag.includes('settings-section"') && !tag.includes('header') && !tag.includes('body') && !tag.includes('chevron') && !tag.includes('sub')) {
        const s = tag.indexOf('id="');
        found.push({ depth, label: s !== -1 ? tag.slice(s, s + 60) : '(no id found in tag)' });
      }
      i = end + 1;
    } else if (raw.slice(i, i + 6) === '</div>') { depth -= 1; i += 6; } else i += 1;
  }
  const EXPECTED = 3;
  found.forEach((e) => { if (e.depth !== EXPECTED) problems.push('Section at DOM depth ' + e.depth + ' (expected ' + EXPECTED + '): ' + e.label); });
  return problems;
}

// --- in-page DOM checks (run inside Chromium) ---
const IN_PAGE_ROWS_CHECK = () => {
  const problems = []; const sheet = document.getElementById('settings-sheet');
  if (!sheet) return problems;
  sheet.querySelectorAll('.settings-row').forEach((row) => {
    if (!row.closest('.settings-section')) {
      const l = row.querySelector('.settings-row-label');
      problems.push('Orphaned .settings-row outside any .settings-section: "' + (l ? l.textContent.trim() : '(no label)') + '"');
    }
  });
  return problems;
};
const IN_PAGE_SETTINGS_SEARCH = () => {
  const problems = []; const input = document.getElementById('settings-search-input');
  if (!input) return problems;
  [{ term: 'italic', l: 'Italic' }, { term: 'line spacing', l: 'Line Spacing' }, { term: 'checkbox', l: 'Toggle checkbox' }].forEach(({ term, l }) => {
    input.value = term; input.dispatchEvent(new Event('input', { bubbles: true }));
    const labels = Array.from(document.querySelectorAll('#settings-sheet .settings-row-label'));
    const match = labels.find((el) => el.textContent.trim().toLowerCase().indexOf(l.toLowerCase()) !== -1);
    if (!match) { problems.push('Searching "' + term + '": row "' + l + '" not found'); return; }
    let el = match.closest('.settings-row'), hidden = false;
    while (el && el.id !== 'settings-sheet') { if (el.style && el.style.display === 'none') { hidden = true; break; } el = el.parentElement; }
    if (hidden) problems.push('Searching "' + term + '": row "' + l + '" exists but is hidden');
  });
  input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
  return problems;
};
const IN_PAGE_HELP_SEARCH = () => {
  const problems = []; const input = document.getElementById('help-search-input');
  if (!input) return problems;
  ['checkbox', 'export', 'tag'].forEach((term) => {
    input.value = term; input.dispatchEvent(new Event('input', { bubbles: true }));
    const noRes = document.getElementById('help-no-results');
    const anyVisible = Array.from(document.querySelectorAll('#help-sheet .help-section, #help-sheet .help-collapsible')).some((el) => el.style.display !== 'none');
    if (!anyVisible || (noRes && noRes.style.display !== 'none')) problems.push('Searching Help for "' + term + '": no section visible');
  });
  input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
  return problems;
};

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 3) { console.error('Usage: node remember-test-harness-pw-v1.js <build.html> <cases.js> <goldens.json | --update <new-goldens.json>>'); process.exit(2); }
  const htmlPath = argv[0]; const casesPath = path.resolve(argv[1]);
  const updateMode = argv[2] === '--update';
  const goldensPath = updateMode ? argv[3] : argv[2];
  if (updateMode && !goldensPath) { console.error('--update requires a new goldens filename'); process.exit(2); }
  if (updateMode && fs.existsSync(goldensPath)) { console.error('REFUSING to overwrite existing goldens file: ' + goldensPath); process.exit(2); }

  const raw = fs.readFileSync(htmlPath, 'utf8');
  let anyFailed = false;
  const report = (label, probs, okMsg) => {
    if (probs.length === 0) console.log('[harness] ' + okMsg);
    else { anyFailed = true; console.log('#### [harness] WARNING: ' + label); probs.forEach((p) => console.log('    ' + p)); }
  };
  report('unclosed CSS comment(s)', checkStyleCommentBalance(raw), 'Style comment balance OK.');
  report('unclosed HTML comment(s)', checkHtmlCommentBalance(raw), 'HTML comment balance OK.');
  report('settings section nesting', checkSettingsSectionNestingDepth(raw), 'Settings section nesting OK.');

  const cases = require(casesPath);
  const browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u === APP_URL) return route.fulfill({ status: 200, contentType: 'text/html', body: raw });
    return route.abort();
  });
  await page.addInitScript(() => {
    window.SpeechSynthesisUtterance = window.SpeechSynthesisUtterance || function (t) { this.text = t; };
  });
  await page.goto(APP_URL, { waitUntil: 'load' });

  const G = (code) => page.evaluate('(0,eval)(' + JSON.stringify(code) + ')');
  const t0 = Date.now(); let ready = false;
  while (Date.now() - t0 < 5000) {
    ready = await G('typeof notes === "object" && Object.keys(notes).length > 0').catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!ready) pageErrors.push('notes never populated within 5s');
  let armingError = null;
  try { await G('(function(){var ids=Object.keys(notes); if(ids.length && typeof openNote==="function") openNote(ids[0]);})()'); }
  catch (e) { armingError = e.message; pageErrors.push('openNote arming failed: ' + e.message); }
  const armed = await G('typeof isCheckboxRaw==="function" && isCheckboxRaw("- [ ] x")===true').catch(() => false);
  if (armed) console.log('[harness] Late-assigned functions ARMED (isCheckboxRaw real, not stub). OK.');
  else { anyFailed = true; console.log('#### [harness] WARNING: late-assigned functions NOT armed ' + (armingError || '')); }

  report('settings rows outside a section', await page.evaluate(IN_PAGE_ROWS_CHECK), 'Settings dialog structure OK.');
  try {
    await G('typeof openSettings==="function" && openSettings()');
    report('Settings search', await page.evaluate(IN_PAGE_SETTINGS_SEARCH), 'Settings search OK.');
  } catch (e) { anyFailed = true; console.log('[harness] WARNING: Settings search check threw: ' + e.message); }
  try {
    await page.evaluate(() => { const b = document.getElementById('help-btn'); if (b) b.click(); });
    report('Help search', await page.evaluate(IN_PAGE_HELP_SEARCH), 'Help search OK.');
  } catch (e) { anyFailed = true; console.log('[harness] WARNING: Help search check threw: ' + e.message); }

  // Cases: functions are called in the page via global scope (covers var/function and let/const alike).
  const results = {}; let errored = 0;
  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    const out = await page.evaluate(({ fn, args }) => {
      let f; try { f = (0, eval)(fn); } catch (e) { f = undefined; }
      if (typeof f !== 'function') return { missing: true };
      let actual;
      try { actual = f.apply(null, args); } catch (e) { actual = 'THREW: ' + e.message; }
      return { ser: JSON.stringify(actual === undefined ? '(undefined)' : actual) };
    }, { fn: c.fn, args: c.args });
    if (out.missing) { results[c.name] = JSON.stringify('HARNESS: window.' + c.fn + ' is not a function'); errored++; }
    else results[c.name] = out.ser;
  }
  await browser.close();

  let pass = 0, fail = 0;
  if (updateMode) {
    fs.writeFileSync(goldensPath, JSON.stringify(results, null, 2));
    console.log('Wrote ' + Object.keys(results).length + ' goldens to ' + goldensPath);
  } else {
    const goldens = JSON.parse(fs.readFileSync(goldensPath, 'utf8'));
    for (const c of cases) {
      const exp = goldens[c.name]; const act = results[c.name];
      if (exp === undefined) { console.log('FAIL: ' + c.name + '\n  (no golden recorded)\n  actual: ' + act); fail++; }
      else if (act === exp) pass++;
      else {
        let i = 0; while (i < Math.min(act.length, exp.length) && act[i] === exp[i]) i++;
        console.log('FAIL: ' + c.name + '\n  expected: ...' + exp.slice(Math.max(0, i - 40), i + 40) + '...\n  actual:   ...' + act.slice(Math.max(0, i - 40), i + 40) + '...');
        fail++;
      }
    }
    console.log('---\nPASS ' + pass + ' / FAIL ' + fail + ' / total ' + cases.length);
  }
  if (pageErrors.length) console.log('(page warnings during load, not test failures: ' + pageErrors.slice(0, 3).join(' | ') + (pageErrors.length > 3 ? ' ...+' + (pageErrors.length - 3) : '') + ')');
  process.exit(fail > 0 || errored > 0 || anyFailed ? 1 : 0);
}
main().catch((e) => { console.error('[harness] FATAL:', e); process.exit(2); });
