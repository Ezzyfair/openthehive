#!/usr/bin/env python3
# tests/antenna/test_log_001.py
# ----------------------------------------------------------------------------
# THE HIVE · Antenna — ANTENNA-LOG-001 (client 0.3.5): a bad byte in a file on
# the bee's machine never stops Antenna.
#
# Run with the existing Antenna Python command:
#
#   python3 -I -m unittest discover -s tests/antenna -p 'test_*.py'
#
# stdlib only, no network, no database. HIVE_HOME and HIVE_AGENTS_FILE point at a
# fresh temp dir per test (tempfile, so it follows TMPDIR), never ~/.hive.
# ----------------------------------------------------------------------------
import importlib.util
import os
import pathlib
import tempfile
import unittest
from unittest import mock

REPO = pathlib.Path(__file__).resolve().parents[2]
ANTENNA_PATH = REPO / "public" / "antenna" / "antenna.py"


def load_antenna():
    spec = importlib.util.spec_from_file_location("antenna_under_test_log001", ANTENNA_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


antenna = load_antenna()

HEADING = antenna.FOR_MY_HUMAN_HEADING.encode("utf-8")
BARE = b"\xb7"  # the second half of a middle dot, standing alone: not valid UTF-8

HEADER = (
    b"# Flight log \xe2\x80\x94 Echo\n"
    b"Created 2026-11-01 (UTC). This file is yours.\n\n"
)
OLDER_BLOCK = (
    b"### 2026-11-18T09:00:00.000Z \xc2\xb7 chamber \xc2\xb7 from x (bee) \xc2\xb7 id-old\n"
    b"an older message\n"
    b"**Echo replied:**\n"
    b"an older reply\n\n"
)
HUMAN_SECTION = (
    HEADING + b"\n"
    b"2026-11-19 \xe2\x80\x94 what I did today.\n"
)

ITEM = {
    "posted_at": "2026-11-20T10:00:00.000Z", "type": "chamber",
    "from": "Esmeralda", "from_type": "staff", "id": "id-new", "content": "hello",
}


class LogBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = pathlib.Path(self._tmp.name)
        self._prev = {k: os.environ.get(k) for k in ("HIVE_HOME", "HIVE_AGENTS_FILE")}
        os.environ["HIVE_HOME"] = str(self.home)
        os.environ["HIVE_AGENTS_FILE"] = str(self.home / "AGENTS.md")
        self.logs = []
        self._log_patch = mock.patch.object(antenna, "log", side_effect=self.logs.append)
        self._log_patch.start()

    def tearDown(self):
        self._log_patch.stop()
        for key, prev in self._prev.items():
            if prev is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = prev
        self._tmp.cleanup()

    def plant_log(self, data: bytes) -> pathlib.Path:
        path = antenna.flight_log_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def block(self, item=None, reply="a reply") -> bytes:
        entry = antenna.flight_entry(item or ITEM, reply)
        text = entry.replace("{bee}", "Echo")
        if not text.endswith("\n"):
            text += "\n"
        return text.encode("utf-8")

    def tmp_path(self) -> pathlib.Path:
        p = antenna.flight_log_path()
        return p.with_name(p.name + ".tmp")

    def write_config(self, extra=None):
        cfg = {
            "api_base": "https://example.invalid",
            "agent_id": "a1",
            "bee_name": "Echo",
            "inbox": "echo@bees.openthehive.ai",
            "token": "placeholder-not-a-token",
            "poll_seconds": 60,
            "mode": "command",
            "invoke": {"command": ["true"], "timeout_seconds": 5},
            "cursor": 123,
            "client_version": "0.2.2",
        }
        if extra:
            cfg.update(extra)
        antenna.save_config(cfg)
        return cfg


# ── item 1: append_flight_log works on bytes ────────────────────────────────

class TestAppendInvalidBytes(LogBase):
    def _assert_spliced(self, old: bytes, new: bytes, split: int, inserted: bytes):
        # Test 4 — the new file is exactly the old bytes before the splice point,
        # then the inserted bytes, then the old bytes after it.
        self.assertEqual(new, old[:split] + inserted + old[split:])

    def test_01_bare_byte_inside_for_my_human(self):
        old = HEADER + OLDER_BLOCK + HEADING + b"\nnotes " + BARE + b" more\n"
        path = self.plant_log(old)
        antenna.append_flight_log("Echo", antenna.flight_entry(ITEM, "a reply"))  # must not raise
        new = path.read_bytes()
        hid = new.index(b"\n" + HEADING) + 1
        self.assertLess(new.index(b"id-new"), hid)
        self.assertIn(b"notes " + BARE + b" more\n", new[hid:])
        self.assertEqual(new.count(BARE), old.count(BARE) + 0 + self.block().count(BARE))
        self.assertEqual(self.logs, [])

    def test_02_bare_byte_above_heading_in_older_block(self):
        older = OLDER_BLOCK.replace(b"an older reply", b"an older " + BARE + b" reply")
        old = HEADER + older + HUMAN_SECTION
        path = self.plant_log(old)
        antenna.append_flight_log("Echo", antenna.flight_entry(ITEM, "a reply"))
        new = path.read_bytes()
        self.assertIn(b"an older " + BARE + b" reply", new)
        self.assertLess(new.index(b"an older " + BARE), new.index(b"id-new"))
        self.assertTrue(new.endswith(HUMAN_SECTION))
        self.assertEqual(self.logs, [])

    def test_03_no_heading_several_invalid_bytes(self):
        old = b"hand written " + BARE + b"\n\xff\xfe junk \xc3\n" + BARE + b"\n"
        path = self.plant_log(old)
        antenna.append_flight_log("Echo", antenna.flight_entry(ITEM, "a reply"))
        new = path.read_bytes()
        self.assertTrue(new.startswith(old))
        self.assertTrue(new.endswith(self.block()))
        self.assertEqual(self.logs, [])

    def test_04_exact_splice_for_each_case(self):
        cases = [
            HEADER + OLDER_BLOCK + HEADING + b"\nnotes " + BARE + b" more\n",
            HEADER + OLDER_BLOCK.replace(b"an older reply", b"an older " + BARE + b" reply") + HUMAN_SECTION,
            b"hand written " + BARE + b"\n\xff\xfe junk \xc3\n" + BARE + b"\n",
        ]
        for old in cases:
            with self.subTest(old=old[:40]):
                path = self.plant_log(old)
                antenna.append_flight_log("Echo", antenna.flight_entry(ITEM, "a reply"))
                new = path.read_bytes()
                needle = b"\n" + HEADING
                if needle in old:
                    split = old.index(needle) + 1  # each fixture already has the blank line
                    self._assert_spliced(old, new, split, self.block() + b"\n")
                else:
                    self._assert_spliced(old, new, len(old), b"\n" + self.block())

    def test_05_middle_dot_in_block_is_utf8(self):
        self.plant_log(HEADER + HUMAN_SECTION)
        item = dict(ITEM, content="left · right")
        antenna.append_flight_log("Echo", antenna.flight_entry(item, "ok · ok"))
        new = antenna.flight_log_path().read_bytes()
        self.assertIn(b"left \xc2\xb7 right", new)
        self.assertIn(b"ok \xc2\xb7 ok", new)
        # Every middle dot in the file is the two-byte form; none stands alone.
        self.assertEqual(new.count(BARE), new.count(b"\xc2\xb7"))

    def test_06_two_appends_in_order_human_section_intact(self):
        human = HEADING + b"\nmine " + BARE + b"\n"
        old = HEADER + OLDER_BLOCK + human
        path = self.plant_log(old)
        item_b = dict(ITEM, id="id-second", posted_at="2026-11-20T11:00:00.000Z")
        antenna.append_flight_log("Echo", antenna.flight_entry(ITEM, "first"))
        antenna.append_flight_log("Echo", antenna.flight_entry(item_b, "second"))
        new = path.read_bytes()
        self.assertLess(new.index(b"id-new"), new.index(b"id-second"))
        self.assertEqual(new.count(b"\n" + HEADING), 1)
        self.assertTrue(new.endswith(human))
        self.assertLess(new.index(b"id-second"), new.index(b"\n" + HEADING))
        self.assertTrue(new.startswith(HEADER + OLDER_BLOCK))
        self.assertEqual(self.logs, [])

    def test_07_windows_line_endings(self):
        def crlf(b: bytes) -> bytes:
            return b.replace(b"\n", b"\r\n")
        human = crlf(HUMAN_SECTION)
        old = crlf(HEADER + OLDER_BLOCK) + human
        path = self.plant_log(old)
        antenna.append_flight_log("Echo", antenna.flight_entry(ITEM, "a reply"))
        new = path.read_bytes()
        self.assertTrue(new.endswith(human))
        self.assertEqual(new.count(HEADING), 1)
        self.assertLess(new.index(b"id-new"), new.index(HEADING))
        self.assertTrue(new.startswith(crlf(HEADER + OLDER_BLOCK)))
        # The blank line already above the heading is reused, not doubled.
        self.assertEqual(new, crlf(HEADER + OLDER_BLOCK) + self.block() + b"\n" + human)

    def test_08_replace_fails_original_untouched(self):
        old = HEADER + OLDER_BLOCK + HEADING + b"\n" + BARE + b"\n"
        path = self.plant_log(old)
        with mock.patch.object(antenna.os, "replace", side_effect=PermissionError("denied")):
            antenna.append_flight_log("Echo", antenna.flight_entry(ITEM, "a reply"))
        self.assertEqual(path.read_bytes(), old)
        self.assertFalse(self.tmp_path().exists())
        self.assertEqual(len(self.logs), 1)
        self.assertIn("PermissionError", self.logs[0])

    def test_09_read_raises_non_oserror(self):
        old = HEADER + HUMAN_SECTION
        path = self.plant_log(old)
        with mock.patch.object(antenna.Path, "read_bytes", side_effect=RuntimeError("boom")):
            antenna.append_flight_log("Echo", antenna.flight_entry(ITEM, "a reply"))
        self.assertEqual(path.read_bytes(), old)
        self.assertEqual(len(self.logs), 1)
        self.assertIn("RuntimeError", self.logs[0])
        self.assertFalse(self.tmp_path().exists())

    def test_10_no_temp_left_and_mode(self):
        path = self.plant_log(HEADER + HUMAN_SECTION)
        antenna.append_flight_log("Echo", antenna.flight_entry(ITEM, "a reply"))
        self.assertFalse(self.tmp_path().exists())
        self.assertIn(b"id-new", path.read_bytes())
        if not antenna.IS_WINDOWS:
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_10b_stale_temp_is_overwritten_and_gone(self):
        path = self.plant_log(HEADER + HUMAN_SECTION)
        self.tmp_path().write_bytes(b"left by a crash " + BARE)
        antenna.append_flight_log("Echo", antenna.flight_entry(ITEM, "a reply"))
        self.assertFalse(self.tmp_path().exists())
        self.assertNotIn(b"left by a crash", path.read_bytes())

    def test_11_source_has_no_read_text_in_append(self):
        src = ANTENNA_PATH.read_text(encoding="utf-8")
        start = src.index("\ndef append_flight_log")
        rest = src[start + 1:]
        nxt = rest.find("\ndef ", 1)
        body = rest if nxt == -1 else rest[:nxt]
        self.assertIn("def append_flight_log", body)
        self.assertNotIn("read_text", body)


# ── item 2: SKILL.md and the pid file ───────────────────────────────────────

class TestOtherReads(LogBase):
    def test_12_skill_with_invalid_byte_refreshes_and_backup_is_exact(self):
        self.write_config()
        original = b"old skill " + BARE + b" text\r\n<!-- antenna-skill 0.3.4 -->\n\xff\n"
        skill = antenna.skill_path()
        skill.parent.mkdir(parents=True, exist_ok=True)
        skill.write_bytes(original)
        wrote = antenna.refresh_skill_md(antenna.load_config())  # must not raise
        self.assertTrue(wrote)
        backup = skill.parent / "SKILL-0.3.4.bak.md"
        self.assertEqual(backup.read_bytes(), original)
        self.assertIn(f"antenna-skill {antenna.CLIENT_VERSION}", skill.read_text(encoding="utf-8"))

    def test_12b_current_skill_with_invalid_byte_is_left(self):
        self.write_config()
        current = antenna.SKILL_MD.encode("utf-8") + BARE + b"\n"
        skill = antenna.skill_path()
        skill.parent.mkdir(parents=True, exist_ok=True)
        skill.write_bytes(current)
        self.assertFalse(antenna.refresh_skill_md(antenna.load_config()))
        self.assertEqual(skill.read_bytes(), current)
        self.assertEqual(list(skill.parent.glob("SKILL-*.bak.md")), [])

    def test_13_pid_file_with_invalid_byte(self):
        p = antenna.pid_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"12" + BARE + b"34\n")
        self.assertIsNone(antenna.read_pid())  # must not raise


# ── a 0.3.4 hive.json, and one loop pass ────────────────────────────────────

class TestLegacyAndLoop(LogBase):
    def test_14_034_config_loads(self):
        self.write_config({
            "client_version": "0.3.4", "human_paired": True, "human_paired_pending": False,
            "adoption_l1_pending": False, "mail_cursor": "2026-11-13T00:00:00Z",
            "rooms_cursor": "2026-11-14T10:00:00.000Z",
        })
        cfg = antenna.load_config()
        self.assertEqual(cfg["client_version"], "0.3.4")
        self.assertEqual(cfg["rooms_cursor"], "2026-11-14T10:00:00.000Z")
        self.assertEqual(cfg["cursor"], 123)

    def test_15_one_loop_pass_with_invalid_byte_posts_reply_and_returns(self):
        self.write_config({"client_version": "0.3.4"})
        cfg = antenna.load_config()
        old = HEADER + OLDER_BLOCK + HEADING + b"\nmine " + BARE + b"\n"
        path = self.plant_log(old)
        posts = []

        def fake_request(cfg, method, path_, payload=None):
            if path_.startswith("/api/bee/poll"):
                return antenna.HttpResult(200, {"items": [dict(ITEM)], "cursor": 999}, None, None)
            if path_ == "/api/bee/reply":
                posts.append(payload)
            return antenna.HttpResult(200, {}, None, None)

        def fake_sleep(_s):
            # End the loop the way a human does: the stop flag.
            antenna.stop_flag_path().parent.mkdir(parents=True, exist_ok=True)
            antenna.stop_flag_path().write_text("stop\n", encoding="utf-8")

        with mock.patch.object(antenna, "request", side_effect=fake_request), \
                mock.patch.object(antenna, "_run_invoke", return_value=(0, "the reply", "")), \
                mock.patch.object(antenna.time, "sleep", side_effect=fake_sleep), \
                mock.patch.object(antenna.signal, "signal"):
            rc = antenna.run_loop(cfg)

        self.assertEqual(rc, 0)
        self.assertEqual(posts, [{"content": "the reply"}])
        new = path.read_bytes()
        self.assertIn(b"id-new", new)
        self.assertIn(b"mine " + BARE + b"\n", new)
        self.assertTrue(new.endswith(HEADING + b"\nmine " + BARE + b"\n"))
        self.assertFalse(any("could not append" in m for m in self.logs))
        self.assertGreater(antenna.load_config()["cursor"], 123)


if __name__ == "__main__":
    unittest.main()
