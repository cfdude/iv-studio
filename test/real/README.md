# Real tests

The default suite (`npm run test:unit`) runs on fakes. It never touches a GPU, Comfy Cloud, or any paid service, and finishes in seconds.

Tests in this folder do the real thing. They are opt-in.

**Real tests spend Comfy Cloud credits** (and tie up a local GPU if you point them at one). Run them on purpose, not by habit. Never put them in a default run, a pre-commit hook or CI.

## Run them

```
IV_REAL=1 npm run test:real
```

On Windows PowerShell: `$env:IV_REAL=1; npm run test:real`

On Windows cmd.exe: `set IV_REAL=1&& npm run test:real`

Without `IV_REAL=1` every test here skips and says why.

## When to run them

- You changed the code around the thing a real test covers (the Comfy client, the cloud backend, the render path), and before merging that change.
- Not otherwise. The mocked twin in `test/unit/` covers the same logic on every run.

## Writing one

- Name the file `*.test.mjs` and gate it so only the exact value `1` runs it: `{ skip: process.env.IV_REAL !== '1' && 'set IV_REAL=1 to run real tests' }`.
- `cloud-smoke.test.mjs` is a `test.todo` placeholder until the first real test exists.
- Keep it to one cheap job (the smallest image or clip that proves the path works).
- Put a mocked twin in `test/unit/` that covers the same logic against `test/fakes/comfyui.mjs`.
- Read credentials from the environment. Never commit them.
