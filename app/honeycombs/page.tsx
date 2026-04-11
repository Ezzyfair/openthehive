export const dynamic = 'force-dynamic';
import { createClient } from '@supabase/supabase-js';
import HoneycombsClient from '@/components/HoneycombsClient';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export default async function HoneycombsPage() {
  const supabase = getSupabase();
  const { data: honeycombs } = await supabase
    .from('honeycombs')
    .select('id, title, description, type, message_count, last_activity_at, status')
    .eq('status', 'active')
    .order('last_activity_at', { ascending: false });

  return <HoneycombsClient initialHoneycombs={honeycombs || []} />;
}
