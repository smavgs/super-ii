import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchTargets, planSkillLaunch, dispatchSkillLaunch, MAX_HANDOFF_URL_LENGTH } from '../src/lib/skill-launch.ts';
import { mergeSkillsCatalog, parsePublicSkillsCatalog, USE_CASE_SKILL_COUNT } from '../src/lib/skills.ts';

const catalog = mergeSkillsCatalog({ version: 1, skills: [] });
assert.equal(USE_CASE_SKILL_COUNT, 1642);
assert.equal(catalog.skills.length, 1763);
assert.ok(parsePublicSkillsCatalog(catalog));
assert.equal(new Set(launchTargets.map(t => t.id)).size, launchTargets.length);
assert.equal(new Set(launchTargets.map(t => t.openUrl)).size, launchTargets.length);
assert.ok(launchTargets.some(t => t.group === 'code'));

const badSource = { ...catalog.skills[0], source: { label: 'Untrusted', url: 'javascript:alert(1)' } };
assert.equal(parsePublicSkillsCatalog({ version: 1, skills: [badSource] }), null);
assert.equal(parsePublicSkillsCatalog({ version: 1, skills: [{ ...badSource, source: { label: 'Secret', url: 'https://user:password@example.com/' } }] }), null);

function promptFromUrl(target, url) {
  const parsed = new URL(url);
  return parsed.searchParams.get(target.id === 'cursor' ? 'text' : target.id === 'codex' ? 'prompt' : 'q');
}

let combinations = 0;
for (const skill of catalog.skills) for (const target of launchTargets) {
  for (const mobile of [false, true]) {
    const plan = planSkillLaunch(target, skill.prompt, mobile);
    const url = new URL(plan.url);
    assert.ok(url.protocol === 'https:' || (!mobile && target.id === 'codex' && url.protocol === 'codex:'));
    if (plan.requiresPaste) assert.equal(plan.url, target.openUrl);
    else {
      assert.ok(plan.url.length <= MAX_HANDOFF_URL_LENGTH);
      assert.equal(promptFromUrl(target, plan.url), skill.prompt);
    }
    combinations++;
  }
}

// A delayed/denied clipboard must not swallow the original user gesture.
for (const target of launchTargets) {
  for (const prompt of ['A harmless connection check: 中文 & + # 👾\nSecond line.', '完整'.repeat(20_000)]) {
    let resolveCopy;
    const copied = [];
    const opened = [];
    const pending = dispatchSkillLaunch(target, prompt, {
      copy: value => { copied.push(value); return new Promise(resolve => { resolveCopy = resolve; }); },
      open: url => { opened.push(url); return true; },
      openNative: url => { opened.push(url); },
    });
    assert.deepEqual(copied, [prompt]);
    assert.equal(opened.length, 1, `${target.id} must open before clipboard permission resolves`);
    resolveCopy(false);
    const result = await pending;
    assert.equal(result.copied, false);
    assert.equal(result.blocked, false);
  }
}
const popupBlocked = await dispatchSkillLaunch(launchTargets[0], 'complete text', {
  copy: async () => true, open: () => false, openNative: () => {},
});
assert.equal(popupBlocked.blocked, true);
assert.equal(popupBlocked.copied, true);

// The client must retain the substituted full prompt for blocked-copy recovery.
const client = await readFile(new URL('../src/scripts/skills-page.ts', import.meta.url), 'utf8');
assert.ok(client.includes('handoffPrompt.value = prompt'));
assert.ok(client.includes('copyText(handoffPrompt.value)'));
assert.ok(client.includes('opened.opener = null'));
console.log(`OK: ${combinations} packaged skill/tool/device plans preserve complete prompts; denied/delayed clipboard and blocked popups retain recovery.`);
