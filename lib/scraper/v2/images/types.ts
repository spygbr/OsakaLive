/**
 * Types for the event image enrichment pipeline.
 */

export type ImageSource = 'venue' | 'instagram'

export type ImageCandidate = {
  url: string
  source: ImageSource
  width?: number
  height?: number
  /** Composite score — higher is better. Accept threshold: 60. */
  score: number
}

export type ImageRunResult = {
  eventId: string
  status: 'applied' | 'miss' | 'error'
  source?: ImageSource
  reason?: string
}
