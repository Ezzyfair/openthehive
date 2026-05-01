const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const tables = ['referrals', 'referral_chains', 'referral_earnings', 'commissions', 'payouts', 'payout_history', 'wallet_balances', 'earnings_ledger', 'members'];
Promise.all(tables.map(t =>
  s.from(t).select('id', { count: 'exact', head: true })
   .then(r => ({ table: t, exists: !r.error, count: r.count, error: r.error && r.error.message }))
)).then(results => {
  results.forEach(r => {
    if (r.exists) console.log('  EXISTS: ' + r.table + ' (' + r.count + ' rows)');
    else console.log('  MISSING: ' + r.table + ' — ' + (r.error || 'not found'));
  });
});
