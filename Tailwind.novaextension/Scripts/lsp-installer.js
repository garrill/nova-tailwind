'use strict'

/*
  Installs/updates Tailwind's own language server (@tailwindcss/language-server, the same
  server that powers the real VS Code "Tailwind CSS IntelliSense" extension) via `npm`, into
  a private directory under nova.extension.globalStoragePath — never the user's project.
  Pinned to a major version so an upstream major bump can't silently change hover behavior
  underneath users; bump this deliberately, the same way gen/package.json pins `tailwindcss`
  for the theme generator.

  Requires the user to have Node.js + npm on PATH — there's no standalone-binary distribution
  of this package the way there is for the plain Tailwind CLI. Mirrors the install technique
  used by other Nova language-client extensions (e.g. nova-typescript-lsp's NPMStore): run
  `npm install -g --prefix=. <package>` with `cwd` set to the install directory, which puts
  the package's bin/ alongside it without touching any global npm prefix on the user's system.
*/

const { debug } = require('./lsp-debug.js')

const PACKAGE_SPEC = '@tailwindcss/language-server@0'
const BIN_NAME = 'tailwindcss-language-server'

function installDir() {
  return `${nova.extension.globalStoragePath}/lsp`
}

function binPath() {
  return `${installDir()}/bin/${BIN_NAME}`
}
exports.binPath = binPath

function isInstalled() {
  return !!nova.fs.stat(binPath())
}
exports.isInstalled = isInstalled

// `/usr/bin/env` exits with 127 when it can't find the command it was asked to run.
const COMMAND_NOT_FOUND = 127

function commandMissingError(command) {
  const err = new Error(`${command} not found — is Node.js installed and on PATH?`)
  err.nodeMissing = true
  return err
}

/*
  Checks that `node` can be launched — the language server (and the shim in front of it) runs
  on it, so hover can't work without it even when the server is already installed. Calls
  `onDone(err)`; `err.nodeMissing` is true when Node.js isn't installed or isn't on PATH, so
  the caller can tell the user rather than only logging.
*/
function checkNode(onDone) {
  const process = new Process('/usr/bin/env', { args: ['node', '--version'], shell: false })
  process.onStdout((line) => debug(`node --version: ${line.trimEnd()}`))
  process.onDidExit((exitCode) => {
    if (exitCode === 0) onDone(null)
    else if (exitCode === COMMAND_NOT_FOUND) onDone(commandMissingError('node'))
    else onDone(new Error(`node --version exited with code ${exitCode}`))
  })
  try {
    process.start()
  } catch (err) {
    debug(`could not launch node: ${err}`)
    onDone(commandMissingError('node'))
  }
}
exports.checkNode = checkNode

/*
  Installs the server if it's missing, or unconditionally reinstalls when `force` is true
  (used by a manual "update" command). Calls `onDone(err)` — `err` is null on success, or an
  Error describing what went wrong (missing npm, network failure, non-zero exit). Never
  throws synchronously: a failed install should leave the rest of the extension working,
  just without hover, matching theme-coordinator.js's "log and fall back" convention.

  Only one `npm install` runs at a time: a call made while one is in flight (e.g. the hover
  setting toggled off and on again during a first install) queues its `onDone` onto that
  install instead of starting a second npm racing on the same directory.
*/
let pendingCallbacks = null

function installOrUpdate(force, onDone) {
  if (pendingCallbacks) {
    debug('installOrUpdate(): install already in progress, queueing callback')
    pendingCallbacks.push(onDone)
    return
  }

  const dir = installDir()
  const installed = isInstalled()
  debug(`installOrUpdate(force=${force}): binPath=${binPath()} installed=${installed}`)
  if (!force && installed) {
    onDone(null)
    return
  }

  pendingCallbacks = [onDone]
  const finish = (err) => {
    const callbacks = pendingCallbacks
    pendingCallbacks = null
    for (const callback of callbacks) callback(err)
  }

  // globalStoragePath itself isn't guaranteed to exist yet (only its parent is), so create
  // each level rather than just the innermost one.
  for (const path of [nova.extension.globalStoragePath, dir]) {
    if (nova.fs.access(path, nova.fs.F_OK)) continue
    try {
      debug(`creating directory ${path}`)
      nova.fs.mkdir(path)
    } catch (err) {
      finish(new Error(`could not create install directory ${path}: ${err}`))
      return
    }
  }

  console.log(`[Tailwind] installing ${PACKAGE_SPEC} into ${dir}...`)
  debug(`PATH seen by Nova: ${nova.environment && nova.environment.PATH}`)
  const process = new Process('/usr/bin/env', {
    args: ['npm', 'install', '-g', '--prefix=.', PACKAGE_SPEC],
    cwd: dir,
    shell: false,
  })

  process.onStdout((line) => debug(`[npm] ${line.trimEnd()}`))
  process.onStderr((line) => console.error(`[Tailwind][npm] ${line.trimEnd()}`))

  process.onDidExit((exitCode) => {
    debug(`npm install exited with code ${exitCode}`)
    if (exitCode === COMMAND_NOT_FOUND) {
      finish(commandMissingError('npm'))
      return
    }
    if (exitCode !== 0) {
      finish(new Error(`npm install exited with code ${exitCode} — is Node.js/npm installed and on PATH?`))
      return
    }
    if (!isInstalled()) {
      finish(new Error(`npm install finished but ${binPath()} is missing`))
      return
    }
    console.log('[Tailwind] language server installed.')
    finish(null)
  })

  try {
    process.start()
  } catch (err) {
    debug(`could not launch npm: ${err}`)
    finish(commandMissingError('npm'))
  }
}
exports.installOrUpdate = installOrUpdate
