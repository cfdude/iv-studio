// The page tier's windows stay hidden so a test run never covers the person's screen (test/ui/driver.mjs sets
// IV_STUDIO_UI_HIDDEN=1). It counts only together with IV_STUDIO_DATA, which the page tier always sets and a normal
// install does not, so a real install can never hide itself with a stray variable.
export const uiHidden = (env = process.env) => env.IV_STUDIO_UI_HIDDEN === '1' && !!env.IV_STUDIO_DATA
