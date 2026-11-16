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
