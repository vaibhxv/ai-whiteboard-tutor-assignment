#!/usr/bin/env node
/**
 * Stand-in for the `claude` CLI in bridge tests (selected with WHYBOARD_CLAUDE_BIN). Replays canned
 * stream-json lines shaped like Claude Code 2.1.x output. FAKE_MODE (passed by the tests through the
 * runner's test-only env seam, because the real child env is an allowlist) picks a scenario:
 *   (unset)    system/init (apiKeySource "none"), 3 text deltas "a" "b" "c", rate_limit_event, result
 *   signedout  "Not logged in" on stderr, exit 1 (also for `auth status`)
 *   slow       init, one delta, then hangs until killed
 *   limit      rate_limit_event with status "rejected", then an error result
 *   apikey     init with apiKeySource "ANTHROPIC_API_KEY"
 *   echo       one text delta holding {argv, stdin, envKeys, cwd} as JSON
 *   length     deltas then a result with stop_reason "max_tokens"
 *   cut        init and deltas, then exit 0 without a result
 *   crash      "segfault-ish failure" on stderr, exit 3
 */
const mode = process.env.FAKE_MODE ?? ''
const argv = process.argv.slice(2)
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')

if (argv[0] === '--version') {
  process.stdout.write('9.9.9 (Claude Code)\n')
  process.exit(0)
}
if (argv[0] === 'auth' && argv[1] === 'status') {
  if (mode === 'signedout') {
    process.stdout.write(JSON.stringify({ loggedIn: false, authMethod: 'none' }) + '\n')
    process.exit(1)
  }
  process.stdout.write(JSON.stringify({
    loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'learner@example.com',
    orgId: 'org-123', orgName: "Learner's Organization", subscriptionType: 'max', planTier: 'max_20x',
  }) + '\n')
  process.exit(0)
}

let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => { stdin += d })
process.stdin.on('end', run)

const init = (apiKeySource = 'none') => out({
  type: 'system', subtype: 'init', cwd: process.cwd(), session_id: 's1', tools: [], mcp_servers: [],
  model: 'claude-sonnet-5-5', apiKeySource, claude_code_version: '9.9.9',
})
const delta = (text) => out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } })
const stop = (reason) => out({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 3 } } })
const rate = (status) => out({
  type: 'rate_limit_event',
  rate_limit_info: {
    status, resetsAt: 1794919800, rateLimitType: 'five_hour',
    unifiedWindows: { five_hour: { utilization: 0.52, resetsAt: 1794919800, status } },
  },
})
const result = (extra = {}) => out({
  type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', result: 'abc',
  usage: { input_tokens: 2, cache_read_input_tokens: 600, output_tokens: 3 }, ...extra,
})

function run() {
  switch (mode) {
    case 'signedout':
      process.stderr.write('Not logged in · Please run /login\n')
      process.exit(1)
      break
    case 'crash':
      process.stderr.write('segfault-ish failure\n')
      process.exit(3)
      break
    case 'slow':
      init(); delta('a')
      setInterval(() => {}, 1000)
      break
    case 'limit':
      init(); rate('rejected')
      result({ is_error: true, subtype: 'error_during_execution', result: "You've hit your limit · resets 5pm" })
      break
    case 'apikey':
      init('ANTHROPIC_API_KEY'); delta('a'); stop('end_turn'); result()
      break
    case 'echo':
      init()
      delta(JSON.stringify({ argv, stdin, envKeys: Object.keys(process.env).sort(), cwd: process.cwd() }))
      stop('end_turn'); result()
      break
    case 'length':
      init(); delta('a'); delta('b'); stop('max_tokens'); result({ stop_reason: 'max_tokens' })
      break
    case 'cut':
      init(); delta('a'); delta('b')
      break
    default:
      init(); delta('a'); delta('b'); delta('c'); stop('end_turn'); rate('allowed'); result()
  }
}
