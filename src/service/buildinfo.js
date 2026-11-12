// The build's identity, shown beside the version so a swapped-in app is obvious at a glance.
// electron.vite.config.mjs injects the short commit (IV_STUDIO_BUILD_SHA, else git's HEAD) at build time.
export const shortSha = (raw) => (/^[0-9a-f]{7,40}$/i.test(String(raw || '').trim()) ? String(raw).trim().slice(0, 7).toLowerCase() : null)

// "1.1.3 · silicon abc1234"; a build with no sha says "dev"
export const versionLabel = (version, sha) => `${version} · silicon ${shortSha(sha) || 'dev'}`

// What the config injects: the env's sha wins, then git's, else nothing
export function buildSha(env, gitHead) {
  return shortSha(env.IV_STUDIO_BUILD_SHA) || shortSha(gitHead) || ''
}
