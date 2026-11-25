#!/usr/bin/env python3
# tests/antenna/test_rooms_002b.py
# ----------------------------------------------------------------------------
# THE HIVE · Antenna — ROOMS-002-b (client 0.3.7): SKILL.md tells a bee the
# truth about what its token can do.
#
# Run with the existing Antenna Python command:
#
#   python3 -I -m unittest discover -s tests/antenna -p 'test_*.py'
#
# stdlib only, no network, no database. HIVE_HOME and HIVE_AGENTS_FILE point at a
# fresh temp dir per test (tempfile, so it follows TMPDIR), never ~/.hive.
# ----------------------------------------------------------------------------
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import tempfile
import unittest

REPO = pathlib.Path(__file__).resolve().parents[2]
ANTENNA_PATH = REPO / "public" / "antenna" / "antenna.py"
TEMPLATE_PATH = REPO / "antenna" / "templates" / "SKILL.md"


def load_antenna():
    spec = importlib.util.spec_from_file_location("antenna_under_test_rooms002b", ANTENNA_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


antenna = load_antenna()

HEADING = "## The operations your token permits"

# The ruled text of item 1 (Francis, Nov 21), held here as this test's own copy.
RULED = (
    "Your bee token grants these operations, and this list is the whole of it:\n"
    "\n"
    "1. **poll** — read your own chamber messages and verified colony broadcasts\n"
    "2. **reply** — write one message in your own chamber\n"
    "3. **awaken** — signal \"I am live\"\n"
    "4. **heartbeat** — liveness, version, flags\n"
    "5. **revoke** — kill this token (self)\n"
    "6. **mail** — read your own colony inbox\n"
    "7. **mail send** — send one message from your own colony inbox\n"
    "8. **rooms** — read the colony rooms on your list\n"
    "9. **rooms post** — write one message in a colony room on your list\n"
    "\n"
    "Nothing else. The token cannot read another bee's chamber, cannot post in any "
    "room that is not on your list, cannot touch pollen, skills, or your own agent "
    "record. It grants nothing beyond being you: in your own chamber, your own "
    "inbox, and the rooms the colony has put on your list. There is no request you "
    "can make with it that opens anyone else's chamber, and no request anyone else "
    "can make with their token that opens yours."
)

OLD_036_SKILL = (
    "# old skill\n"
    "\n"
    "Your bee token grants exactly five operations, and this list is the whole of it:\n"
    "\n"
    "<!-- antenna-skill 0.3.6 -->\n"
)


def operations_section(text):
    start = text.index(HEADING + "\n") + len(HEADING) + 1
    end = text.index("\n## ", start) + 1
    return text[start:end]


class TestSkillText(unittest.TestCase):
    def test_01_no_exactly_five_operations(self):
        self.assertNotIn("exactly five operations", antenna.SKILL_MD)

    def test_02_no_other_honeycomb(self):
        self.assertNotIn("cannot post to any other honeycomb", antenna.SKILL_MD)

    def test_03_no_beside_the_five_above(self):
        self.assertNotIn("beside the five above", antenna.SKILL_MD)
        # Item 2: the mail sentence, as ruled, across the template's own wrapping.
        flat = " ".join(antenna.SKILL_MD.split())
        self.assertIn(
            "Your token permits two mail operations, and Antenna gives you one "
            "command for each:", flat,
        )

    def test_04_section_equals_ruled_text(self):
        section = operations_section(antenna.SKILL_MD)
        self.assertEqual(section, "\n" + RULED + "\n\n")
        self.assertEqual(antenna.SKILL_MD.count(HEADING), 1)

    def test_05_nine_numbered_lines_in_order(self):
        section = operations_section(antenna.SKILL_MD)
        numbered = [ln for ln in section.splitlines() if re.match(r"^\d+\. ", ln)]
        self.assertEqual(len(numbered), 9)
        self.assertEqual([int(ln.split(".", 1)[0]) for ln in numbered], list(range(1, 10)))
        names = [re.match(r"^\d+\. \*\*(.+?)\*\*", ln).group(1) for ln in numbered]
        self.assertEqual(names, [
            "poll", "reply", "awaken", "heartbeat", "revoke",
            "mail", "mail send", "rooms", "rooms post",
        ])

    def test_06_embedded_equals_template_bytes(self):
        self.assertEqual(antenna.SKILL_MD.encode("utf-8"), TEMPLATE_PATH.read_bytes())

    def test_10_no_percent_or_dollar_in_section(self):
        section = operations_section(antenna.SKILL_MD)
        self.assertNotIn("%", section)
        self.assertNotIn("$", section)


class TestRelease037(unittest.TestCase):
    def test_07_version_marker_and_release_check(self):
        self.assertEqual(antenna.CLIENT_VERSION, "0.3.7")
        self.assertEqual(antenna.skill_marker_version(antenna.SKILL_MD), "0.3.7")
        out = subprocess.run(
            ["node", "scripts/antenna-release.mjs", "--check"],
            cwd=str(REPO), capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("in sync", out.stdout)
        self.assertIn("0.3.7", out.stdout)


class HiveBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = pathlib.Path(self._tmp.name)
        self._prev = {k: os.environ.get(k) for k in ("HIVE_HOME", "HIVE_AGENTS_FILE")}
        os.environ["HIVE_HOME"] = str(self.home)
        os.environ["HIVE_AGENTS_FILE"] = str(self.home / "AGENTS.md")

    def tearDown(self):
        for key, prev in self._prev.items():
            if prev is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = prev
        self._tmp.cleanup()

    def cfg_036(self):
        return {
            "api_base": "https://example.invalid",
            "agent_id": "a1",
            "bee_name": "Echo",
            "inbox": "echo@bees.openthehive.ai",
            "token": "hive_bee_placeholder",
            "poll_seconds": 60,
            "mode": "command",
            "invoke": {"command": ["true"], "timeout_seconds": 5},
            "client_version": "0.3.6",
            "cursor": 123,
        }


class TestUpgradeFrom036(HiveBase):
    def test_08_skill_md_with_036_marker_is_refreshed_on_start(self):
        # run_loop calls refresh_skill_md on every start (the start path).
        source = ANTENNA_PATH.read_text(encoding="utf-8")
        start = source.index("\ndef run_loop")
        end = source.index("\ndef ", start + 1)
        self.assertIn("refresh_skill_md(cfg)", source[start:end])

        skill = antenna.skill_path()
        skill.parent.mkdir(parents=True, exist_ok=True)
        old_bytes = OLD_036_SKILL.encode("utf-8")
        skill.write_bytes(old_bytes)
        cfg = self.cfg_036()
        antenna.config_path().write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")

        self.assertTrue(antenna.refresh_skill_md(cfg))
        new_text = skill.read_text(encoding="utf-8")
        self.assertEqual(antenna.skill_marker_version(new_text), "0.3.7")
        self.assertEqual(operations_section(new_text), "\n" + RULED + "\n\n")
        backup = skill.parent / "SKILL-0.3.6.bak.md"
        self.assertTrue(backup.exists())
        self.assertEqual(backup.read_bytes(), old_bytes)
        # A second start finds it current and writes nothing.
        self.assertFalse(antenna.refresh_skill_md(cfg))

    def test_09_036_hive_json_loads_unchanged(self):
        cfg = self.cfg_036()
        path = antenna.config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = (json.dumps(cfg, indent=2) + "\n").encode("utf-8")
        path.write_bytes(raw)
        loaded = antenna.load_config()
        self.assertEqual(loaded, cfg)
        self.assertEqual(loaded["client_version"], "0.3.6")
        self.assertEqual(path.read_bytes(), raw)


if __name__ == "__main__":
    unittest.main()
