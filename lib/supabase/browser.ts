// lib/supabase/browser.ts
// ----------------------------------------------------------------------------
// THE HIVE — browser Supabase client for the member login page.
// Anon key only. Everything that matters is enforced server-side.
// ----------------------------------------------------------------------------
'use client';

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
