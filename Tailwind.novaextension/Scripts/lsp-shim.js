'use strict'

/*
  Runs under plain Node (launched by lsp-client.js as `node lsp-shim.js <server-bin>`), NOT
  loaded by Nova's own runtime. Sits between Nova's LanguageClient and
  @tailwindcss/language-server, relaying LSP traffic in both directions and fixing these
  incompatibilities:

  1. The server forks a helper (oxide-helper.js) that inherits its stdout and prints a plain
     "Listening for messages..." line into the middle of the LSP stream. VS Code's parser skips
     it; Nova's doesn't — it loses framing sync and silently drops every later message,
     including the server's dynamic `textDocument/hover` registration. Only well-formed
     `Content-Length` frames are forwarded to Nova; anything else is dropped.

  2. The server reads its settings only by pulling `workspace/configuration` (section
     "tailwindCSS") — it ignores initializationOptions — and Nova answers that request itself
     from the extension's own preference keys, which gives `{}`. Nova's LanguageClient can't
     override core LSP methods, so the shim rewrites Nova's reply on its way to the server,
     overlaying the settings passed in the TAILWIND_LSP_SETTINGS env var (JSON).

  3. The server registers `textDocument/completion` (dynamically, via client/registerCapability)
     even with `suggestions: false`, which only makes it answer with nothing. Once a language
     server claims completion for a syntax, Nova stops offering that syntax's own XML
     completions (e.g. the Twig extension's `{% if %}` snippets), so the shim removes the
     completion registration (and any static `completionProvider`) before Nova sees it —
     completions come from completion-provider.js only.
*/

const { spawn } = require('child_process')

const serverBin = process.argv[2]
const serverArgs = process.argv.slice(3)
const settings = JSON.parse(process.env.TAILWIND_LSP_SETTINGS || '{}')
const debug = process.env.TAILWIND_LSP_DEBUG === '1'

function log(message) {
  if (debug) process.stderr.write(`[tailwind-lsp-shim] ${message}\n`)
}

const HEADER_END = Buffer.from('\r\n\r\n')
const CONTENT_LENGTH = /^content-length:\s*(\d+)\s*$/im

// Incremental LSP frame reader. Calls onMessage(bodyBuffer) per complete frame, and
// onStray(buffer) for bytes that aren't part of any frame (text written outside framing).
function createFrameReader(onMessage, onStray) {
  let pending = Buffer.alloc(0)
  return (chunk) => {
    pending = Buffer.concat([pending, chunk])
    for (;;) {
      const start = pending.indexOf('Content-Length:')
      if (start < 0) {
        // Keep a short tail in case a header is split across chunks; the rest can't be a frame.
        const keep = Math.min(pending.length, 'Content-Length:'.length - 1)
        if (pending.length > keep) onStray(pending.slice(0, pending.length - keep))
        pending = pending.slice(pending.length - keep)
        return
      }
      if (start > 0) {
        onStray(pending.slice(0, start))
        pending = pending.slice(start)
      }
      const headerEnd = pending.indexOf(HEADER_END)
      if (headerEnd < 0) return
      const match = CONTENT_LENGTH.exec(pending.slice(0, headerEnd).toString('ascii'))
      if (!match) {
        // Malformed header — skip past it so one bad line can't wedge the stream.
        onStray(pending.slice(0, headerEnd + HEADER_END.length))
        pending = pending.slice(headerEnd + HEADER_END.length)
        continue
      }
      const bodyStart = headerEnd + HEADER_END.length
      const bodyEnd = bodyStart + parseInt(match[1], 10)
      if (pending.length < bodyEnd) return
      onMessage(pending.slice(bodyStart, bodyEnd))
      pending = pending.slice(bodyEnd)
    }
  }
}

function frame(body) {
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}

const server = spawn(process.execPath, [serverBin, ...serverArgs], { stdio: ['pipe', 'pipe', 'inherit'] })

// ids of server→client `workspace/configuration` requests awaiting Nova's reply → requested items
const pendingConfigRequests = new Map()
// ids of client→server `textDocument/hover` requests awaiting the server's reply
const pendingHoverRequests = new Set()

// The server replies with the deprecated MarkedString shape (`{language, value}`, or an array
// of those/strings); Nova advertises only MarkupContent (`markdown`/`plaintext`), so convert.
function toMarkupContent(contents) {
  const parts = Array.isArray(contents) ? contents : [contents]
  if (parts.length === 1 && parts[0] && parts[0].kind) return parts[0] // already MarkupContent
  const value = parts
    .map((part) => (typeof part === 'string' ? part : `\`\`\`${part.language || ''}\n${part.value}\n\`\`\``))
    .join('\n\n')
  return { kind: 'markdown', value }
}

server.stdout.on('data', createFrameReader(
  (body) => {
    let out = body
    try {
      const message = JSON.parse(body.toString('utf8'))
      if (!message.method && pendingHoverRequests.has(message.id)) {
        pendingHoverRequests.delete(message.id)
        if (message.result && message.result.contents) {
          message.result.contents = toMarkupContent(message.result.contents)
          out = Buffer.from(JSON.stringify(message), 'utf8')
        }
        log(`hover reply ${message.id}: ${message.result ? 'content' : 'null (nothing at that position)'}`)
      } else if (message.method === 'workspace/configuration' && message.id !== undefined) {
        pendingConfigRequests.set(message.id, message.params.items || [])
      } else if (message.result && message.result.capabilities) {
        if (message.result.capabilities.completionProvider) {
          delete message.result.capabilities.completionProvider
          out = Buffer.from(JSON.stringify(message), 'utf8')
        }
        log(`initialize reply capabilities: ${Object.keys(message.result.capabilities).join(', ')}`)
      } else if (message.method === 'client/registerCapability') {
        const registrations = message.params.registrations
        message.params.registrations = registrations.filter((r) => r.method !== 'textDocument/completion')
        if (message.params.registrations.length !== registrations.length) {
          out = Buffer.from(JSON.stringify(message), 'utf8')
          log('removed textDocument/completion registration')
        }
        log(`server registering: ${message.params.registrations.map((r) => r.method).join(', ') || '(nothing)'}`)
      }
    } catch (err) {
      log(`unparseable server message passed through: ${err}`)
    }
    process.stdout.write(frame(out))
  },
  (stray) => log(`dropped ${stray.length} stray byte(s) from server stdout: ${JSON.stringify(stray.toString('utf8').slice(0, 120))}`)
))

process.stdin.on('data', createFrameReader(
  (body) => {
    let out = body
    try {
      const message = JSON.parse(body.toString('utf8'))
      if (message.method === 'textDocument/hover' && message.id !== undefined) pendingHoverRequests.add(message.id)
      const hoverCaps = message.method === 'initialize' &&
        message.params && message.params.capabilities && message.params.capabilities.textDocument &&
        message.params.capabilities.textDocument.hover
      if (hoverCaps && hoverCaps.dynamicRegistration) {
        // Nova advertises dynamic hover registration but never sends textDocument/hover for a
        // dynamically registered provider. Claiming it can't register dynamically makes the
        // server declare `hoverProvider` statically in its initialize reply instead.
        hoverCaps.dynamicRegistration = false
        log('initialize: disabled hover dynamicRegistration so hoverProvider is declared statically')
        out = Buffer.from(JSON.stringify(message), 'utf8')
      } else if (message.id !== undefined && !message.method && pendingConfigRequests.has(message.id)) {
        const items = pendingConfigRequests.get(message.id)
        pendingConfigRequests.delete(message.id)
        const results = Array.isArray(message.result) ? message.result : items.map(() => null)
        message.result = items.map((item, i) => {
          if (item.section !== 'tailwindCSS') return results[i]
          const fromNova = results[i] && typeof results[i] === 'object' ? results[i] : {}
          return { ...fromNova, ...settings }
        })
        log(`injected tailwindCSS settings into workspace/configuration reply ${message.id}`)
        out = Buffer.from(JSON.stringify(message), 'utf8')
      }
    } catch (err) {
      log(`unparseable client message passed through: ${err}`)
    }
    server.stdin.write(frame(out))
  },
  (stray) => log(`dropped ${stray.length} stray byte(s) from client stdin`)
))

process.stdin.on('end', () => server.stdin.end())
server.on('exit', (code, signal) => {
  log(`server exited (code=${code}, signal=${signal})`)
  process.exit(code === null ? 1 : code)
})
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.kill(signal))
}
