export type Badge = {
  mode: 'recorded' | 'live'
  text: string
  model: string
  billedTo: 'api-key' | 'subscription' | 'recording'
  capturedAt?: string
}
