// The training recipe: options, estimates and the train.sh each makes (checked against Fizgig 4b3f07f's and 9.3.2's flags),
// a bash syntax check of every script, and a real run of the budget stop with stand-in commands.
// node test/training-recipe.mjs
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { budgetSeconds, datasetToml, epochsFor, estimate, rankOf, TRAIN_PRESETS, trainOptions, trainScript } from '../src/service/training.js'

let n = 0
const ok = (name, fn) => {
  fn()
  n++
  console.log('ok', name)
}
const bash = process.platform === 'win32' ? ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe'].find((p) => fs.existsSync(p)) : '/bin/bash'

ok('defaults are the recipe Tess and Theo trained with', () => {
  const o = trainOptions()
  assert.deepEqual([o.preset, o.learn, o.detail, o.mode, o.checkpoints, o.seed, o.captionDropout, o.cleanEnd, o.budget], ['standard', 'look_voice', 'normal', 'likeness', 20, 42, 0.05, 60, null])
  const sh = trainScript({ name: 'tess_1', epochs: 40, saveEvery: 2 })
  for (const flag of ['--network_dim 16 --network_alpha 16', '--seed 42', '--max_train_epochs 40 --save_every_n_epochs 2', 'lownoise_pct=60', 'photo_blocks=20-49', 'clip_blocks=20-49', 'audio_blocks=20-49', 'caption_dropout=0.05', 'tread=0.5@2-47', '--optimizer_type automagic3 --learning_rate 1e-6', '--save_state --save_state_on_train_end --keep_last_n_states 2'])
    assert.ok(sh.includes(flag), flag)
  assert.ok(!sh.includes('--resume') && !sh.includes('timeout') && !sh.includes('--train_blocks'))
})

ok('junk options fall back safely', () => {
  const o = trainOptions({ preset: 'huge', learn: 'x', detail: 'max', mode: '?', checkpoints: 7, rank: 64, seed: -5, captionDropout: 0.3, cleanEnd: 33, budget: -1 })
  assert.deepEqual([o.preset, o.learn, o.detail, o.mode, o.checkpoints, o.rank, o.seed, o.captionDropout, o.cleanEnd, o.budget], ['standard', 'look_voice', 'normal', 'likeness', 20, null, 0, 0.05, 60, null])
  assert.equal(trainOptions({ budget: '5' }).budget, 5)
  assert.equal(trainOptions(null).preset, 'standard')
})

ok('presets: Quick is rank 8 and shorter, Thorough longer; a rank choice wins', () => {
  assert.equal(rankOf(trainOptions({ preset: 'quick' })), 8)
  assert.equal(rankOf(trainOptions({ preset: 'thorough' })), 16)
  assert.equal(rankOf(trainOptions({ preset: 'quick', rank: 32 })), 32)
  const items = 24 // Theo: 8 stills + 8 clips
  const [q, s, t] = ['quick', 'standard', 'thorough'].map((p) => epochsFor(items, trainOptions({ preset: p })))
  assert.ok(q < s && s < t, `${q} ${s} ${t}`)
  assert.equal(s, 117) // the Standard rule is the old default (2800 / items, 40 to 120)
  for (const p of Object.keys(TRAIN_PRESETS)) {
    assert.ok(epochsFor(1, trainOptions({ preset: p })) <= TRAIN_PRESETS[p].max)
    assert.ok(epochsFor(500, trainOptions({ preset: p })) >= TRAIN_PRESETS[p].min)
  }
})

ok('whole look trains 6-49 and leaves the identity windows out', () => {
  const sh = trainScript({ name: 'a', epochs: 40, saveEvery: 2, options: { mode: 'whole' } })
  assert.ok(sh.includes('--train_blocks 6-49'))
  assert.ok(!sh.includes('photo_blocks='))
})

ok('the other knobs reach the script', () => {
  const sh = trainScript({ name: 'a', epochs: 50, saveEvery: 5, options: { preset: 'quick', seed: 7, captionDropout: 0, cleanEnd: 8 } })
  for (const flag of ['--network_dim 8 --network_alpha 8', '--seed 7', 'caption_dropout=0', 'lownoise_pct=8']) assert.ok(sh.includes(flag), flag)
})

ok('fine detail: 704 px buckets and about twice the time', () => {
  assert.ok(datasetToml('a').includes('resolution = [512, 512]'))
  assert.ok(datasetToml('a', { detail: 'fine' }).includes('resolution = [704, 704]'))
  const a = estimate({ items: 24, epochs: 60, gpu: 'H200' })
  const b = estimate({ items: 24, epochs: 60, gpu: 'H200', detail: 'fine' })
  assert.ok(b.minutes > a.minutes * 1.7 && b.dollars > a.dollars * 1.7)
})

ok('train more resumes from the saved state in the run folder', () => {
  const sh = trainScript({ name: 'theo_x_2', epochs: 80, saveEvery: 3, resume: 'theo_x_2_mmh3-000060-state' })
  assert.ok(sh.includes('--resume "/vol/train/theo_x_2/loras/theo_x_2_mmh3-000060-state"'))
  assert.ok(sh.includes('--max_train_epochs 80'))
})

ok('a budget buys the right number of GPU seconds', () => {
  assert.equal(budgetSeconds(null, 4.54), null)
  assert.equal(budgetSeconds(4.69, 4.54), 3600) // $4.54 an hour plus the $0.15 start-up share
  assert.equal(budgetSeconds(0.2, 4.54), 300) // never less than five minutes
})

if (bash) {
  ok('every script variant is valid bash', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-recipe-'))
    const variants = [{}, { mode: 'whole' }, { preset: 'quick', detail: 'fine', learn: 'look' }]
    let k = 0
    for (const options of variants)
      for (const extra of [{}, { resume: 'a_mmh3-000010-state' }, { maxSeconds: 900 }, { resume: 'a_mmh3-000010-state', maxSeconds: 900 }]) {
        const f = path.join(dir, `t${k++}.sh`)
        fs.writeFileSync(f, trainScript({ name: 'a', epochs: 40, saveEvery: 2, options, ...extra }).replace(/\r\n/g, '\n'))
        execFileSync(bash, ['-n', f.replace(/\\/g, '/')])
      }
    assert.equal(k, 12)
  })

  // the script runs on Modal's Linux; macOS has no `timeout`, so this one is skipped there
  const hasTimeout = spawnSync(bash, ['-c', 'command -v timeout'], { encoding: 'utf8' }).status === 0
  if (!hasTimeout) console.log('skip the budget run (no timeout command here)')
  else ok('the budget stop really stops training, keeps going to the end, and says so', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-budget-'))
    // stand-ins: caching is instant, training "runs" 30 s; the cap is 2 s past the start, so timeout ends it
    let sh = trainScript({ name: 'a', epochs: 40, saveEvery: 2, maxSeconds: 2 }).replace(/\r\n/g, '\n')
    sh = sh.replace('cd "/opt/Fizgig"', `cd "${dir.replace(/\\/g, '/')}"`)
    sh = sh.replace(/python3 src\/fizgig\/families\/cache\.py[^\n]*/g, 'true')
    sh = sh.replace(/python3 src\/fizgig\/families\/train\.py[\s\S]*?audio_vae_fp32\.safetensors"/, 'sleep 30')
    sh = sh.replace('echo $(( END - $(date +%s) > 60 ? END - $(date +%s) : 60 ))', 'echo 2').replace(/\[ "\$l" -gt 60 \] && echo "\$l" \|\| echo 60/, 'echo 2')
    sh += 'echo AFTER\n'
    const f = path.join(dir, 'train.sh')
    fs.writeFileSync(f, sh)
    const t0 = Date.now()
    const r = spawnSync(bash, [f.replace(/\\/g, '/')], { encoding: 'utf8', timeout: 60000 })
    const secs = (Date.now() - t0) / 1000
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /BUDGET REACHED/)
    assert.match(r.stdout, /AFTER/)
    assert.ok(secs < 20, `took ${secs} s`)
  })
} else console.log('skip bash checks (no bash)')

console.log(`training-recipe: ${n} checks passed`)
