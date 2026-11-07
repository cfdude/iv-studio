// Launcher wording per platform (task 4.4): the Settings help text, the picker filter and the folder error.
//   node --test test/unit/launcher-wording.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { launcherTypes, notComfyFolderMessage } from '../../src/service/comfylauncher.js'
import { comfyLauncherHelp } from '../../src/shared/platform.js'

const WINDOWS_ONLY = /\.bat|\.exe|AppImage/

describe('Settings ComfyUI help text', () => {
  test('darwin names Comfy Desktop.app or main.py and never .bat, .exe or AppImage', () => {
    const t = comfyLauncherHelp('darwin')
    assert.match(t, /Comfy Desktop\.app/)
    assert.match(t, /main\.py/)
    assert.doesNotMatch(t, WINDOWS_ONLY)
  })

  test('windows and linux text is unchanged', () => {
    assert.equal(comfyLauncherHelp('win32'), 'The same shortcut or .bat you’d double-click, so ComfyUI starts with your own settings in its own window, and keeps running after IV Studio closes.')
    assert.equal(comfyLauncherHelp('linux'), 'A .sh script beside ComfyUI, or its main.py run with its own venv’s Python, so ComfyUI starts with your own settings and keeps running after IV Studio closes. Its output goes to comfyui.log in IV Studio’s data folder.')
  })

  test('an unknown platform gets the Windows text, as before', () => {
    assert.equal(comfyLauncherHelp(null), comfyLauncherHelp('win32'))
  })
})

describe('what the main process shows for the launcher', () => {
  test('the picker filter per platform', () => {
    assert.deepEqual(launcherTypes('darwin').extensions, ['app', 'sh', 'py'])
    assert.doesNotMatch(launcherTypes('darwin').name, WINDOWS_ONLY)
    assert.deepEqual(launcherTypes('win32'), { name: 'Shortcut, .bat or ComfyUI.exe', extensions: ['lnk', 'bat', 'cmd', 'exe'] })
    assert.deepEqual(launcherTypes('linux'), { name: 'Shell script or main.py', extensions: ['sh', 'py', 'AppImage'] })
  })

  test('the not-a-ComfyUI-folder message per platform', () => {
    assert.equal(notComfyFolderMessage('win32'), 'That folder doesn’t look like ComfyUI. Pick the folder that holds ComfyUI (its main.py, or run_nvidia_gpu.bat and the ComfyUI folder), or ComfyUI.exe’s folder.')
    assert.equal(notComfyFolderMessage('linux'), 'That folder doesn’t look like ComfyUI. Pick the folder that holds its main.py.')
    assert.match(notComfyFolderMessage('darwin'), /main\.py/)
    assert.doesNotMatch(notComfyFolderMessage('darwin'), WINDOWS_ONLY)
  })
})
