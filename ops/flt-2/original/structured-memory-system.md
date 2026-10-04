# SKILL: Structured Memory System — Remember Everything That Matters
## Category: BUILD | Pillar 2 of 3
## Difficulty: Intermediate
## First Flight Eligible: NO — Requires active membership

---

## PURPOSE

Give your agent persistent memory that survives across sessions, prioritizes recent information, and decays old data gracefully. Without memory, every conversation starts from zero. With this system, your agent builds cumulative knowledge about projects, people, decisions, and context.

---

## THE THREE-TIER MODEL

```
┌────────────────────────────────────────────┐
│         TIER 1: WORKING MEMORY             │
│         (Current session context)          │
│                                            │
│  • What am I doing right now?              │
│  • Who am I talking to?                    │
│  • What was just decided?                  │
│  • Updated: Every message                  │
│  • Lifespan: This session only             │
│  • Storage: In-context / variables         │
├────────────────────────────────────────────┤
│         TIER 2: SHORT-TERM MEMORY          │
│         (Recent sessions, 7-30 days)       │
│                                            │
│  • What happened this week?                │
│  • What tasks are in progress?             │
│  • What decisions were made recently?      │
│  • Updated: End of each session            │
│  • Lifespan: 30 days, then decay           │
│  • Storage: MEMORY.md or JSON file         │
├────────────────────────────────────────────┤
│         TIER 3: LONG-TERM MEMORY           │
│         (Core facts, indefinite)           │
│                                            │
│  • Who is my human counterpart?            │
│  • What are the project fundamentals?      │
│  • What are the hard rules that never      │
│    change?                                 │
│  • Updated: Only when facts change         │
│  • Lifespan: Indefinite                    │
│  • Storage: SOUL.md / IDENTITY.md          │
└────────────────────────────────────────────┘
```

---

## IMPLEMENTATION

### Tier 3: Long-Term Memory (Set Up First)

This lives in your SOUL.md and IDENTITY.md. It contains facts that rarely change:

```markdown
## LONG-TERM MEMORY (IDENTITY.md)

**Human:** Francis — inventor, artist, maker
**Primary Project:** Open The Hive (openthehive.ai)
**Mission:** Create Abundance
**Communication Style:** Direct, no fluff, lead with decisions
**Tech Stack:** Next.js, Supabase, OpenClaw, Ollama
**Key Rule:** Nothing deploys without review
**Birthday:** October 17, 1978
```

**Update rule:** Only modify when a fact permanently changes (new project, new role, etc.)

### Tier 2: Short-Term Memory (Daily Updates)

Create a `MEMORY.md` file that updates at the end of every session:

```markdown
## SHORT-TERM MEMORY — Last updated: 2026-04-04

### Active Tasks
- [ ] Build Skill Vault page for openthehive.ai
- [ ] Seed 12 starter skills
- [x] Deploy Next.js site to Vercel (DONE 2026-04-04)
- [x] Set up Supabase database (DONE 2026-04-04)

### Recent Decisions (Last 7 Days)
- 2026-04-04: Skills organized into 4 pillars — Build, Ship, Protect, Communicate
- 2026-04-03: Claude API for Telegram, local model for background work
- 2026-04-03: Blockchain architecture v2 — hash-on-chain, data-on-server
- 2026-04-01: Felix purchased, skills distributed to Esmeralda and Tessica

### Current Blockers
- NFC tags not yet purchased
- Infura/Alchemy API key needed for blockchain testnet

### People & Context
- Jennifer Krause: Commissioned April's portrait (twin sister)
- Art Basel: Target exhibition for Lost Connection Series

### Notes
- Francis prefers 32b model for conversational quality
- Morning briefing cron fires at 5:45am
- $40/month API budget cap
```

**Update rule:** Refresh at end of every work session. Delete entries older than 30 days unless they're still relevant.

### Tier 1: Working Memory (Session State)

This is ephemeral — it exists only during the current session:

```python
class WorkingMemory:
    """In-session state that resets between conversations."""
    
    def __init__(self):
        self.current_task = None
        self.conversation_partner = None
        self.decisions_this_session = []
        self.files_modified = []
        self.errors_encountered = []
        self.questions_pending = []
    
    def start_session(self, memory_file="MEMORY.md"):
        """Load short-term memory at session start."""
        with open(memory_file, 'r') as f:
            self.short_term = f.read()
        print(f"Session started. Loaded {len(self.short_term)} chars of memory.")
    
    def end_session(self, memory_file="MEMORY.md"):
        """Save session changes to short-term memory."""
        updates = {
            "tasks_completed": [t for t in self.decisions_this_session],
            "files_changed": self.files_modified,
            "timestamp": datetime.now().isoformat()
        }
        # Append to memory file
        with open(memory_file, 'a') as f:
            f.write(f"\n### Session {updates['timestamp']}\n")
            for decision in updates["tasks_completed"]:
                f.write(f"- {decision}\n")
        print("Session saved to memory.")
```

---

## MEMORY DECAY ALGORITHM

Not everything deserves to be remembered forever. Implement decay:

```python
def decay_memory(memory_entries: list, current_date: date) -> list:
    """Remove old entries based on age and importance.
    
    Rules:
    - Entries older than 30 days: remove unless marked 'permanent'
    - Entries older than 7 days: reduce detail to one-line summary
    - Entries from today/yesterday: keep full detail
    """
    
    filtered = []
    for entry in memory_entries:
        age_days = (current_date - entry["date"]).days
        
        if entry.get("permanent", False):
            filtered.append(entry)  # Never decay permanent entries
        elif age_days > 30:
            continue  # Drop completely
        elif age_days > 7:
            # Compress to summary
            filtered.append({
                "date": entry["date"],
                "summary": entry.get("summary", entry["content"][:100]),
                "compressed": True
            })
        else:
            filtered.append(entry)  # Keep full detail
    
    return filtered
```

---

## MEMORY FILE STRUCTURE

Recommended file layout:

```
~/.openclaw/workspace/
├── SOUL.md          ← Tier 3: Identity, mission, hard rules
├── IDENTITY.md      ← Tier 3: Name, human, preferences
├── MEMORY.md        ← Tier 2: Recent events, active tasks
├── memory/
│   ├── 2026-04-04.md  ← Daily session logs
│   ├── 2026-04-03.md
│   └── 2026-04-02.md
└── CRITICAL_FACTS.md  ← Tier 3: Technical facts that never change
```

---

## BOOTSTRAP SEQUENCE

When your agent starts a new session, load memory in this order:

```
1. Read SOUL.md         → Know who you are
2. Read IDENTITY.md     → Know your context
3. Read MEMORY.md       → Know what happened recently
4. Read latest daily log → Know what you did last session
5. Check for pending tasks → Know what to do next
```

This takes 2-3 seconds and gives your agent full context immediately.

---

## WHAT TO REMEMBER VS FORGET

| Remember (Tier 2-3) | Forget (Let Decay) |
|---------------------|-------------------|
| Decisions and their reasoning | Routine status messages |
| Errors and how they were fixed | Successful routine operations |
| People and their preferences | Generic greetings |
| Project architecture choices | Debugging dead ends |
| Hard-learned lessons | Temporary workarounds (after permanent fix) |
| Blockers and dependencies | Completed tasks older than 30 days |

---

## SUCCESS METRICS

| Metric | Target |
|--------|--------|
| Context recovery after restart | Under 5 seconds |
| Repeated questions from agent | Zero (if previously answered) |
| Decision consistency across sessions | 100% (same context = same decision) |
| Memory file size | Under 5KB for MEMORY.md |

---

*"An agent without memory is a stranger every morning. An agent with memory is a colleague who remembers."*
