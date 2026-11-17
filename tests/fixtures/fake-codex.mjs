#!/usr/bin/env node
/**
 * Stand-in for the `codex` CLI in bridge tests (selected with WHYBOARD_CODEX_BIN). Replays the documented
 * `codex exec --json` event shapes. FAKE_MODE picks a scenario:
 *   (unset)    thread.started, turn.started, a reasoning item, one agent_message item, turn.completed
 *   signedout  "Not logged in" on stderr, exit 1 (also for `login status`)
 *   failed     turn.failed with a usage-limit message
 *   error      a top-level error event
 *   echo       one agent_message holding {argv, stdin, envKeys} as JSON
 */
const mode = process.env.FAKE_MODE ?? ''
const argv = process.argv.slice(2)
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')

if (argv[0] === '--version') {
  process.stdout.write('codex-cli 0.99.0\n')
  process.exit(0)
}
if (argv[0] === 'login' && argv[1] === 'status') {
  if (mode === 'signedout') {
    process.stderr.write('Not logged in\n')
    process.exit(1)
  }
  process.stderr.write('Logged in using ChatGPT\n')
  process.exit(0)
}

let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => { stdin += d })
process.stdin.on('end', () => {
  if (mode === 'signedout') {
    process.stderr.write('Error: Not logged in. Run `codex login`.\n')
    process.exit(1)
  }
  out({ type: 'thread.started', thread_id: 't-1' })
  out({ type: 'turn.started' })
  if (mode === 'failed') {
    out({ type: 'turn.failed', error: { message: "You've hit your usage limit. Try again later." } })
    process.exit(1)
  }
  if (mode === 'error') {
    out({ type: 'error', message: 'stream disconnected before completion' })
    process.exit(1)
  }
  out({ type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: 'thinking about it' } })
  const text = mode === 'echo'
    ? JSON.stringify({ argv, stdin, envKeys: Object.keys(process.env).sort() })
    : '{"t":"say","text":"Hello"}\n{"t":"say","text":"World"}\n'
  out({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text } })
  out({ type: 'turn.completed', usage: { input_tokens: 1200, cached_input_tokens: 1000, output_tokens: 40 } })
})
