// app/api/bee/poll/route.ts
// ----------------------------------------------------------------------------
// THE HIVE - bee poll endpoint (pipe build step 3).
// A bee (no service key) pulls signed broadcasts over the internet, authing with
// its agent_api_key. The server reads the service-role-locked broadcasts table
// and returns envelopes the bee verifies with Ezzy's .pub before acting.
//   poll -> [here] -> bee runs C1 verify -> C2 bounded -> C3 opt-in -> act
// ----------------------------------------------------------------------------
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic' // never cache; always live

// Service-role client. SERVER-SIDE ONLY - never shipped to the browser/bee.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function GET(req: NextRequest) {
  // 1. authenticate the bee by its agent_api_key
  const key = req.headers.get('x-agent-key')
  if (!key) {
    return NextResponse.json({ error: 'missing x-agent-key' }, { status: 401 })
  }
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('agent_api_key', key)
    .single()
  if (!agent) {
    return NextResponse.json({ error: 'unknown agent' }, { status: 401 })
  }

  // 2. cursor: the bee passes the last id it has processed
  const since = Number(req.nextUrl.searchParams.get('since') ?? '0') || 0
  const nowIso = new Date().toISOString()

  // 3. service-role read: newer than cursor, colony-wide OR addressed to me, not expired
  const { data: rows, error } = await admin
    .from('broadcasts')
    .select('id, intent, payload, signature, signer, audience, target_agent_id, expires_at')
    .gt('id', since)
    .or(`audience.eq.all,target_agent_id.eq.${agent.id}`)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('id', { ascending: true })
    .limit(50)
  if (error) {
    return NextResponse.json({ error: 'poll failed' }, { status: 500 })
  }

  // 4. hand back the envelopes + the new cursor. The bee verifies each with the .pub.
  const cursor = rows && rows.length ? rows[rows.length - 1].id : since
  return NextResponse.json({ broadcasts: rows ?? [], cursor })
}
