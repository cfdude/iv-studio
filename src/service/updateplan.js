// Which updater a copy of IV Studio runs. Kept free of Electron so a test can drive it with stand-ins.
//
// The Apple Silicon build (github.com/cfdude/iv-studio) is signed with its own maintainer's Developer ID (not notarised), and upstream's
// Mac updater (src/main/macupdater.js) would swap in upstream's unsigned build. So on a Mac the updater is OFF: no
// check, no download, no install on quit, no swap. The person updates by downloading from the releases page.
// To turn it back on deliberately, launch with IV_STUDIO_MAC_UPDATES=1 (a Mac copy then uses macupdater.js as upstream
// has it - note its feed (macupdate.js RELEASES) is still upstream's hollisorg/iv-studio, whose builds are not ours).
export const SILICON_HOME = 'https://github.com/cfdude/iv-studio'
export const SILICON_RELEASES = `${SILICON_HOME}/releases`

export const macUpdatesOn = (env = process.env) => env.IV_STUDIO_MAC_UPDATES === '1'

// impls: { mac, portable, standard, off } - each a function that starts that updater and returns { check, install }.
export function selectUpdater({ mac, portable, env = process.env, impls }) {
  if (mac) return macUpdatesOn(env) ? impls.mac() : impls.off()
  if (portable) return impls.portable()
  return impls.standard()
}

export const OFF_WHY = 'Updates are off on this build. Download new versions from the releases page and install them yourself.'

// The updater of a copy whose updates are off: states itself once, never touches the network or the disk.
export function offUpdater({ set }) {
  set({ status: 'off', available: null, percent: null, error: null, why: OFF_WHY })
  return { check: async () => ({ status: 'off' }), install: () => false }
}
