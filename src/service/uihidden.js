// The page tier's windows stay hidden so a test run never covers the person's screen (test/ui/driver.mjs sets
// IV_STUDIO_UI_HIDDEN=1). It counts only together with IV_STUDIO_DATA and IV_TEST_RUN_DIR, which the page tier always
// sets (IV_STUDIO_DATA is also a documented setting, so it alone would not be enough), so a real install can never
// hide itself with a stray variable.
export const uiHidden = (env = process.env) => env.IV_STUDIO_UI_HIDDEN === '1' && !!env.IV_STUDIO_DATA && !!env.IV_TEST_RUN_DIR
