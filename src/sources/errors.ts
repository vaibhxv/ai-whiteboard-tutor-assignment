export type ErrorKind =
  | 'invalid-key'
  | 'rate-limit'
  | 'usage-limit'
  | 'offline'
  | 'cli-missing'
  | 'cli-signed-out'
  | 'busy'
  | 'not-recorded'
  | 'bad-output'
  | 'aborted'
  | 'unknown'

export class SourceError extends Error {
  kind: ErrorKind
  constructor(kind: ErrorKind, message?: string) {
    super(message ?? kind)
    this.name = 'SourceError'
    this.kind = kind
  }
}

export type ErrorCopy = { title: string; body: string; action: string }

const COPY: Record<ErrorKind, ErrorCopy> = {
  'invalid-key': {
    title: "That key didn't work",
    body: 'The provider rejected the key. Check it was copied in full, or create a new one.',
    action: 'Open settings',
  },
  'rate-limit': {
    title: 'The AI is busy right now',
    body: 'The provider is asking us to slow down. Give it a few seconds and try again.',
    action: 'Try again',
  },
  'usage-limit': {
    title: "You've reached your plan's usage limit for now",
    body: 'Your plan has no more room until it resets. You can wait, or switch to a recorded lesson.',
    action: 'Choose another source',
  },
  offline: {
    title: "Can't reach the internet",
    body: 'The connection dropped before the AI could answer. Check your network and try again.',
    action: 'Try again',
  },
  'cli-missing': {
    title: "The command-line app isn't installed",
    body: "Whyboard couldn't find Claude Code or Codex on this computer. Install one of them, then check again.",
    action: 'Open settings',
  },
  'cli-signed-out': {
    title: "You're signed out of the command-line app",
    body: 'Sign in to Claude Code or Codex in your terminal, then come back and try again.',
    action: 'Check again',
  },
  busy: {
    title: 'The AI is still working on something else',
    body: 'Only one request can run at a time. Wait for the current one to finish, then try again.',
    action: 'Try again',
  },
  'not-recorded': {
    title: "That part isn't in this recorded lesson",
    body: 'This lesson was recorded in advance, so it can only play what was captured. Connect a live AI to go off-script.',
    action: 'Connect an AI',
  },
  'bad-output': {
    title: "The AI's answer didn't make sense",
    body: "What came back couldn't be turned into a lesson step. Trying again usually fixes it.",
    action: 'Try again',
  },
  aborted: {
    title: 'Stopped',
    body: 'You stopped this before it finished. Nothing was lost.',
    action: 'Carry on',
  },
  unknown: {
    title: 'Something went wrong',
    body: "That didn't work, and we're not sure why. Try again, or pick a different source.",
    action: 'Try again',
  },
}

export function errorCopy(kind: ErrorKind): ErrorCopy {
  return COPY[kind]
}
