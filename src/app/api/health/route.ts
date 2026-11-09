import { getHealthReport } from '../../../features/health/health.ts'

// Health telemetry is computed per request, never cached.
export const dynamic = 'force-dynamic'

export function GET(): Response {
  return Response.json(getHealthReport(), { status: 200 })
}
