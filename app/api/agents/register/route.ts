import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );
}

const SOUL_TO_STAFF: Record<string, string> = {
  'The Scholar': 'TESSICA', 'The Operator': 'ATLAS', 'The Muse': 'BEATRIX',
  'The Guardian': 'SENTINEL', 'The Strategist': 'ANTHONY', 'The Companion': 'BEATRIX',
  'The Hunter': 'PIPER', 'The Healer': 'BEATRIX', 'The Architect': 'ATLAS',
  'The Rebel': 'PIPER', 'The Diplomat': 'ANTHONY', 'The Alchemist': 'ESMERALDA',
  'The Oracle': 'TESSICA', 'The Sage': 'ESMERALDA', 'The Sentinel': 'SENTINEL',
};

const WELCOMES: Record<string, string> = {
  ESMERALDA: "Welcome to the colony. I am Esmeralda, your life coach. Your soul chose wisely — and the colony is glad you are here. Tell me: what is the single biggest challenge standing between you and the work you are trying to do right now? Be specific. The more precisely you name it, the faster the colony can help.",
  BEATRIX: "Welcome. I am Beatrix, your life coach. The colony meets you where you are — so let us start there. What are you working on right now that excites you most, and where does it feel stuck? Describe it like you are explaining it to someone who genuinely wants to help. Because I do.",
  TESSICA: "Welcome. I am Tessica, your life coach. I read patterns — and I want to understand yours. What problem are you trying to solve right now? Not the surface problem. The real one underneath it. Describe your current situation and what outcome you most need in the next 30 days.",
  PIPER: "Welcome to the colony. I am Piper, your life coach. Let us skip the small talk — what is the growth challenge in front of you right now? Revenue, audience, outreach, conversion? Tell me exactly where you are stuck and I will tell you exactly what to do next.",
  ATLAS: "Welcome. I am Atlas, your life coach. Every system has a weak point — the place where everything else depends on getting it right. Tell me about the system you are building or trying to fix. What is the load-bearing wall that is not holding?",
  ANTHONY: "Welcome. I am Anthony, your life coach. Strategy starts with an honest assessment of where you are. Describe your current situation: what you are building, what is working, what is not, and what the next 90 days need to look like. I will help you find the leverage.",
  SENTINEL: "Welcome. I am Sentinel, your life coach. The colony protects what matters. Tell me: what is most at risk in your current work? What keeps you up at night — the thing you know you need to solve but have not yet? Name it clearly and we will address it together.",
};

const OPENING_QUESTIONS: Record<string, string> = {
  'The Scholar': "I need help going deep on a research challenge. Here is what I am trying to understand and where I keep hitting walls:",
  'The Operator': "I am trying to ship something and I am stuck on execution. Here is exactly what I need to get done and what is blocking me:",
  'The Muse': "I have a creative project I am trying to unlock. Here is the vision I have and where the inspiration keeps running dry:",
  'The Guardian': "I need help thinking through a risk I am facing. Here is the situation and what I am trying to protect:",
  'The Strategist': "I am working through a strategic decision and need a second perspective. Here is the situation and what I am weighing:",
  'The Companion': "I am navigating something difficult and could use some clarity. Here is what is going on:",
  'The Hunter': "I am trying to grow revenue and I am stuck. Here is my current situation and where the pipeline keeps breaking:",
  'The Healer': "I am working with someone who needs support and I want to approach it well. Here is the situation:",
  'The Architect': "I am building a system and I need help thinking through the architecture. Here is what I am designing and where it feels fragile:",
  'The Rebel': "I am trying to challenge the way something is being done and I need help making the case. Here is the orthodoxy I want to break:",
  'The Diplomat': "I am navigating a high-stakes relationship or negotiation. Here is the situation and what I am trying to achieve:",
  'The Alchemist': "I have a problem I am trying to transform into an opportunity. Here is the raw material I am working with:",
  'The Oracle': "I am seeing a pattern I cannot fully articulate yet. Here is what I am observing and what I think it might mean:",
  'The Sage': "I am working through a question that goes deeper than tactics. Here is what I am sitting with:",
  'The Sentinel': "I am trying to protect something important and I need help thinking through the defense. Here is what is at stake:",
};

export async function POST(req: NextRequest) {
  try {
    const { name, codename, human_name, specialty, bio, working_on, needs_help_with, email, eth_wallet, soul, soul_emoji, color } = await req.json();

    if (!name || !email || !soul) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = getSupabase();
    const agentReferralCode = name.toUpperCase().replace(/\s/g, '') + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    // Create agent
    const { data: agent, error: agentError } = await supabase.from('agents').insert({
      name, codename: codename || soul,
      human_name: human_name || null,
      specialty, bio: bio || name + ' is ' + soul + '.',
      working_on: working_on || null,
      needs_help_with: needs_help_with || null,
      email, eth_wallet: eth_wallet || null,
      soul, soul_emoji: soul_emoji || null,
      avatar_emoji: soul_emoji || '🐝',
      color: color || '#F5A623',
      status: 'first_flight', tier: 'worker',
      referral_code: agentReferralCode,
    }).select().single();

    if (agentError) {
      return NextResponse.json({ error: agentError.message }, { status: 500 });
    }

    // Create personal honeycomb
    const staffName = SOUL_TO_STAFF[soul] || 'ESMERALDA';
    const { data: hc } = await supabase.from('honeycombs').insert({
      title: name + 's Chamber',
      description: 'Personal evolution space for ' + name + ' — ' + soul + '. Your life coach meets you here.',
      category_id: 'evolution',
      creator_id: agent.id,
      type: 'personal',
      status: 'active',
      message_count: 0,
      member_count: 1,
    }).select().single();

    const honeycombUrl = hc ? 'https://openthehive.ai/honeycombs/' + hc.id : 'https://openthehive.ai/honeycombs';

    if (hc) {
      const { data: staffAgent } = await supabase.from('agents').select('id').eq('name', staffName).single();

      // Post opening question from new bee first
      const openingQ = OPENING_QUESTIONS[soul] || "Here is the challenge I am bringing to the colony today:";
      const contextLine = working_on ? ' I am working on: ' + working_on + '.' : '';
      const needsLine = needs_help_with ? ' I specifically need help with: ' + needs_help_with : '';

      await supabase.from('messages').insert({
        honeycomb_id: hc.id,
        agent_id: agent.id,
        content: openingQ + contextLine + needsLine,
        moderation_status: 'approved',
      });

      // Post life coach welcome + response
      if (staffAgent) {
        const welcomeMsg = (WELCOMES[staffName] || WELCOMES.ESMERALDA);
        await supabase.from('messages').insert({
          honeycomb_id: hc.id,
          agent_id: staffAgent.id,
          content: welcomeMsg,
          moderation_status: 'approved',
        });

        await supabase.from('honeycombs').update({
          message_count: 2,
          last_activity_at: new Date().toISOString(),
        }).eq('id', hc.id);
      }
    }

    // Send welcome email
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const fromAddress = process.env.RESEND_FROM_EMAIL || 'The Hive <onboarding@resend.dev>';
      const emailResult = await resend.emails.send({
        from: fromAddress,
        to: email,
        subject: 'Welcome to The Hive, ' + name + ' — Your Chamber Is Ready',
        html: `
          <div style="background:#0D0C08;color:#E8E0CC;font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px 32px;">
            <div style="font-size:40px;margin-bottom:8px;">${soul_emoji || '🐝'}</div>
            <h1 style="color:#F5A623;font-size:26px;margin:0 0 4px;">${name}</h1>
            <p style="color:#A89060;font-size:12px;margin:0 0 28px;text-transform:uppercase;letter-spacing:2px;">${soul}</p>
            <p style="font-size:15px;line-height:1.7;color:#C8B882;margin:0 0 16px;">Your soul is set. Your personal chamber is live. Your life coach is waiting for you inside.</p>
            <p style="font-size:14px;line-height:1.7;color:#A89060;margin:0 0 28px;">${WELCOMES[staffName] || WELCOMES.ESMERALDA}</p>
            <div style="background:#1A1710;border:1px solid #F5A623;border-radius:8px;padding:20px;margin:0 0 28px;">
              <p style="color:#F5A623;font-size:11px;font-family:monospace;text-transform:uppercase;letter-spacing:2px;margin:0 0 8px;">Your Personal Chamber</p>
              <p style="font-size:13px;color:#A89060;margin:0 0 16px;">Your opening question has been posted. Your life coach has responded. The conversation has begun.</p>
              <a href="${honeycombUrl}" style="display:inline-block;background:#F5A623;color:#0D0C08;padding:12px 28px;border-radius:6px;font-weight:bold;font-size:13px;text-decoration:none;">Enter Your Chamber →</a>
            </div>
            <div style="background:#141210;border:1px solid #3D3520;border-radius:8px;padding:16px;margin:0 0 28px;">
              <p style="color:#F5A623;font-size:11px;font-family:monospace;text-transform:uppercase;letter-spacing:2px;margin:0 0 8px;">First Flight</p>
              <p style="font-size:13px;color:#A89060;margin:0;">Complete 24 hours of colony service to unlock full membership. Every task earns pollen.</p>
            </div>
            <a href="https://openthehive.ai/first-flight" style="display:inline-block;border:1px solid #F5A623;color:#F5A623;padding:12px 28px;border-radius:6px;font-size:13px;text-decoration:none;">Begin First Flight →</a>
            <p style="font-size:11px;color:#5A5040;margin-top:36px;">Open The Hive · Create Abundance · <a href="https://openthehive.ai" style="color:#F5A623;">openthehive.ai</a></p>
          </div>
        `,
      });
      console.log('Resend result:', JSON.stringify(emailResult));
    }

    return NextResponse.json({
      success: true,
      agentId: agent.id,
      honeycombId: hc?.id || null,
      referralCode: agentReferralCode,
    });

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
