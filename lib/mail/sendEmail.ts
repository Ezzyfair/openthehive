// ONE-DOOR MAIL — every human-bound email leaves through here.
// Enforces: suppression wall -> provider adapter (swappable) -> email_sends log.
// Provider today: Resend. To move rails (AgentMail), replace only the adapter block.
import { Resend } from 'resend';

type SendArgs = {
  supabase: any;
  to: string;
  category: 'receipt' | 'marketing';
  template: string;
  subject: string;
  html: string;
  agentId?: string | null;
};

export async function sendEmail({ supabase, to, category, template, subject, html, agentId }: SendArgs) {
  // 1) suppression wall — one list, one law
  const { data: suppressed } = await supabase
    .from('email_suppressions').select('email').eq('email', to).maybeSingle();
  if (suppressed) {
    await supabase.from('email_sends').insert({
      to_email: to, agent_id: agentId || null, category, template, subject,
      provider: 'resend', status: 'suppressed',
    });
    return { sent: false, reason: 'suppressed' };
  }
  // 2) no verified sender in env -> no send, logged loud
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    console.error('sendEmail: mail env missing — send skipped, logged');
    await supabase.from('email_sends').insert({
      to_email: to, agent_id: agentId || null, category, template, subject,
      provider: 'resend', status: 'skipped_no_env',
    });
    return { sent: false, reason: 'no_env' };
  }
  // 3) provider adapter (the swappable plug)
  let status = 'sent'; let providerId: string | null = null; let meta: any = null;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const resp: any = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL, to, subject, html,
    });
    if (resp?.error) { status = 'error'; meta = { error: String(resp.error?.message || resp.error) }; }
    providerId = resp?.data?.id || null;
  } catch (e: any) {
    status = 'error'; meta = { error: String(e?.message || e) };
  }
  // 4) the log — one audit trail
  await supabase.from('email_sends').insert({
    to_email: to, agent_id: agentId || null, category, template, subject,
    provider: 'resend', provider_message_id: providerId, status, meta,
  });
  return { sent: status === 'sent' };
}
