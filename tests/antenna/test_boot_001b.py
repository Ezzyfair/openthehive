#!/usr/bin/env python3
# tests/antenna/test_boot_001b.py
# ----------------------------------------------------------------------------
# THE HIVE · Antenna — ANTENNA-BOOT-001-b (client 0.3.6): nothing but the bee's
# own words reaches a chamber, and an item the bee has seen is never handed to
# it again.
#
# Run with the existing Antenna Python command:
#
#   python3 -I -m unittest discover -s tests/antenna -p 'test_*.py'
#
# stdlib only, no network, no database. HIVE_HOME and HIVE_AGENTS_FILE point at a
# fresh temp dir per test (tempfile, so it follows TMPDIR), never ~/.hive.
# antenna.request, antenna._run_invoke, antenna.heartbeat and antenna.time.sleep
# are replaced for every loop test.
# ----------------------------------------------------------------------------
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock

REPO = pathlib.Path(__file__).resolve().parents[2]
ANTENNA_PATH = REPO / "public" / "antenna" / "antenna.py"


def load_antenna():
    spec = importlib.util.spec_from_file_location("antenna_under_test_boot001b", ANTENNA_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


antenna = load_antenna()

# Message 26069849, in full.
ERROR_LINE = (
    "⚠️ Agent couldn't generate a response. Note: some tool actions may have "
    "already been executed — please verify before retrying."
)

# INVOKE_ERROR_SIGNATURES on base 4963408, byte for byte.
BASE_SIGNATURES_SOURCE = (
    "INVOKE_ERROR_SIGNATURES: List[Tuple[str, str]] = [\n"
    "    (\"contains\", \"LLM request timed out\"),\n"
    "    (\"contains\", \"Request timed out before a response\"),\n"
    "    (\"first_token\", \"Error:\"),\n"
    "    (\"startswith\", \"Traceback (most recent call last):\"),\n"
    "]\n"
)

PAGE = [
    {"id": "m1", "posted_at": "2026-11-22T10:00:00.000Z", "type": "chamber",
     "from": "Coach", "from_type": "human", "content": "first"},
    {"id": "m2", "posted_at": "2026-11-22T10:00:01.000Z", "type": "chamber",
     "from": "Coach", "from_type": "human", "content": "second"},
    {"id": "m3", "posted_at": "2026-11-22T10:00:02.000Z", "type": "chamber",
     "from": "Coach", "from_type": "human", "content": "third"},
]


def cursor_of(item):
    return antenna.iso_to_cursor(item["posted_at"])


# ─────────────────────────────────────────────────────────────────────────────
# screen_reply
# ─────────────────────────────────────────────────────────────────────────────

class TestScreenReply(unittest.TestCase):
    def test_01_marker_alone(self):
        self.assertEqual(antenna.screen_reply("NO_REPLY"), ("", "marker_only"))

    def test_02_line_then_marker_posts_nothing(self):
        self.assertFalse(antenna.MARKER_TAIL_POSTS_REST)
        self.assertEqual(antenna.screen_reply("3/5.\n\nNO_REPLY"), ("", "marker_only"))

    def test_03_message_9a81b016(self):
        text = "Duplicate. Same content, already logged.\n\nNO_REPLY"
        self.assertEqual(antenna.screen_reply(text), ("", "marker_only"))

    def test_04_two_marker_lines(self):
        text = "A real line.\n\nNO_REPLY\n\n  NO_REPLY  \n"
        self.assertEqual(antenna.screen_reply(text), ("", "marker_only"))
        with mock.patch.object(antenna, "MARKER_TAIL_POSTS_REST", True):
            self.assertEqual(antenna.screen_reply(text), ("A real line.", "marker_stripped"))

    def test_05_marker_inside_sentence(self):
        text = "I will not post NO_REPLY again."
        self.assertEqual(antenna.screen_reply(text), (text, None))

    def test_06_marker_on_earlier_line(self):
        text = "NO_REPLY\nBut here is a real answer."
        self.assertEqual(antenna.screen_reply(text), (text, None))

    def test_07_lower_case_is_not_the_marker(self):
        self.assertEqual(antenna.screen_reply("no_reply"), ("no_reply", None))

    def test_08_message_26069849(self):
        self.assertEqual(antenna.screen_reply(ERROR_LINE), ("", "runtime_error"))

    def test_09_error_line_quoted_after_200_chars(self):
        text = ("Here is a long real answer about the flight plan. " * 5) + "It once said: " + ERROR_LINE
        self.assertGreater(text.find("Agent couldn't"), 200)
        self.assertEqual(antenna.screen_reply(text), (text, None))

    def test_10_whitespace_only(self):
        self.assertEqual(antenna.screen_reply("   "), ("", "empty"))

    def test_11_switch_on_posts_the_rest(self):
        with mock.patch.object(antenna, "MARKER_TAIL_POSTS_REST", True):
            self.assertEqual(antenna.screen_reply("3/5.\n\nNO_REPLY"), ("3/5.", "marker_stripped"))
            self.assertEqual(
                antenna.screen_reply("Duplicate. Same content, already logged.\n\nNO_REPLY"),
                ("Duplicate. Same content, already logged.", "marker_stripped"),
            )


# ─────────────────────────────────────────────────────────────────────────────
# deliver
# ─────────────────────────────────────────────────────────────────────────────

class TestDeliver(unittest.TestCase):
    def _cfg(self, mode="command"):
        return {"mode": mode, "invoke": {"command": ["x"], "timeout_seconds": 5}}

    def _deliver(self, ret, mode="command"):
        with mock.patch.object(antenna, "_run_invoke", lambda cfg, framed: ret):
            return antenna.deliver(self._cfg(mode), {"content": "hi"})

    def test_12_empty_output_is_silence(self):
        self.assertEqual(self._deliver((0, "", "")), "")
        self.assertEqual(self._deliver((0, " \n ", "")), "")

    def test_13_four_older_shapes_still_raise(self):
        with self.assertRaises(antenna.InvokeError):
            self._deliver((0, "LLM request timed out after 30s", ""))
        with self.assertRaises(antenna.InvokeError):
            self._deliver((0, "Request timed out before a response was generated", ""))
        with self.assertRaises(antenna.InvokeError):
            self._deliver((0, "Error: something broke", ""))
        with self.assertRaises(antenna.InvokeError):
            self._deliver((0, "Traceback (most recent call last):\n  File a.py", ""))

    def test_14_nonzero_exit(self):
        with self.assertRaises(antenna.InvokeError):
            self._deliver((1, "", "boom"))
        with self.assertRaises(antenna.Unreachable) as ctx:
            self._deliver((1, "", "boom"), mode="openclaw")
        self.assertNotIsInstance(ctx.exception, antenna.InvokeError)


# ─────────────────────────────────────────────────────────────────────────────
# the loop, against a fake colony
# ─────────────────────────────────────────────────────────────────────────────

class _Stop(Exception):
    pass


class LoopBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = pathlib.Path(self._tmp.name)
        self._prev = {k: os.environ.get(k) for k in ("HIVE_HOME", "HIVE_AGENTS_FILE")}
        os.environ["HIVE_HOME"] = str(self.home)
        os.environ["HIVE_AGENTS_FILE"] = str(self.home / "AGENTS.md")
        self.logs = []
        self.posts = []
        self.poll_paths = []
        self.heartbeats = []
        self.invoked = []

    def tearDown(self):
        for key, prev in self._prev.items():
            if prev is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = prev
        self._tmp.cleanup()

    def write_config(self, extra=None):
        cfg = {
            "api_base": "https://example.invalid",
            "agent_id": "a1",
            "bee_name": "Echo",
            "inbox": "echo@bees.openthehive.ai",
            "token": "hive_bee_placeholder",
            "poll_seconds": 60,
            "mode": "command",
            "invoke": {"command": ["true"], "timeout_seconds": 5},
            "cursor": 123,
            "client_version": "0.3.5",
        }
        if extra:
            cfg.update(extra)
        antenna.save_config(cfg)
        return antenna.load_config()

    def disk_cursor(self):
        return json.loads(antenna.config_path().read_text(encoding="utf-8"))["cursor"]

    def run_pass(self, cfg, answers, pages=None, ticks=1, extra_patches=None):
        """Run the loop for `ticks` ticks. pages[i] is the item list of poll i
        (empty after the last); answers[i] is the agent's (returncode, stdout,
        stderr) for the i-th invoke, or an exception to raise."""
        pages = list(pages if pages is not None else [PAGE])
        answers = list(answers)
        sleeps = {"n": 0}

        def fake_request(cfg_, method, path, payload=None):
            if path.startswith("/api/bee/poll"):
                self.poll_paths.append(path)
                items = pages.pop(0) if pages else []
                return antenna.HttpResult(200, {"items": items}, None, None)
            if path == "/api/bee/reply":
                self.posts.append(payload["content"])
            return antenna.HttpResult(200, {}, None, None)

        def fake_invoke(cfg_, framed):
            self.invoked.append(framed)
            answer = answers.pop(0)
            if isinstance(answer, BaseException):
                raise answer
            return answer

        def fake_heartbeat(cfg_, flags):
            self.heartbeats.append(list(flags))
            return {}

        def fake_sleep(_s):
            sleeps["n"] += 1
            if sleeps["n"] >= ticks:
                raise _Stop()

        patches = [
            mock.patch.object(antenna, "log", side_effect=self.logs.append),
            mock.patch.object(antenna, "request", fake_request),
            mock.patch.object(antenna, "_run_invoke", fake_invoke),
            mock.patch.object(antenna, "heartbeat", fake_heartbeat),
            mock.patch.object(antenna.time, "sleep", fake_sleep),
            mock.patch.object(antenna, "HEARTBEAT_EVERY_TICKS", 1),
        ] + list(extra_patches or [])
        for p in patches:
            p.start()
        try:
            return antenna.run_loop(cfg)
        finally:
            for p in reversed(patches):
                p.stop()

    def flight_log(self):
        path = antenna.flight_log_path()
        return path.read_text(encoding="utf-8") if path.exists() else ""


class TestLoopScreen(LoopBase):
    def test_15_only_the_real_line_is_posted(self):
        cfg = self.write_config()
        with self.assertRaises(_Stop):
            self.run_pass(cfg, [(0, "A real line.", ""), (0, "NO_REPLY", ""), (0, "2/3.\n\nNO_REPLY", "")])
        self.assertEqual(self.posts, ["A real line."])
        for post in self.posts:
            self.assertNotIn("NO_REPLY", post)
            self.assertNotIn("2/3.", post)
        self.assertIn("no-reply marker for m2; nothing posted", self.logs)
        self.assertIn("no-reply marker for m3; nothing posted", self.logs)
        self.assertNotIn("NO_REPLY", self.flight_log())
        self.assertEqual(self.disk_cursor(), cursor_of(PAGE[2]))

    def test_16_runtime_error_line_not_posted_not_asked_again(self):
        cfg = self.write_config()
        with self.assertRaises(_Stop):
            self.run_pass(cfg, [(0, "One.", ""), (0, ERROR_LINE, ""), (0, "Three.", "")])
        self.assertEqual(self.posts, ["One.", "Three."])
        self.assertEqual(len(self.invoked), 3)  # item 3 handed over in the same pass
        self.assertIn("invoke_error:1", self.heartbeats[0])
        self.assertIn("runtime error line from the agent for m2; not posted, not asked again", self.logs)
        self.assertEqual(self.disk_cursor(), cursor_of(PAGE[2]))

    def test_17_silence_is_not_asked_again(self):
        cfg = self.write_config()
        with self.assertRaises(_Stop):
            self.run_pass(cfg, [(0, "", "")], pages=[[PAGE[0]], []], ticks=2)
        self.assertEqual(self.posts, [])
        self.assertFalse(any(f.startswith("invoke_error") for hb in self.heartbeats for f in hb))
        self.assertIn("no reply for m1 (silence is allowed)", self.logs)
        self.assertEqual(len(self.poll_paths), 2)
        self.assertEqual(self.poll_paths[1], f"/api/bee/poll?cursor={cursor_of(PAGE[0])}")
        self.assertEqual(len(self.invoked), 1)

    def test_18_openclaw_marker_only_posts_nothing(self):
        cfg = self.write_config({"mode": "openclaw"})
        with self.assertRaises(_Stop):
            self.run_pass(cfg, [(0, "NO_REPLY", "")], pages=[[PAGE[0]]])
        self.assertEqual(self.posts, [])
        self.assertIn("no-reply marker for m1; nothing posted", self.logs)


class TestCursorPerItem(LoopBase):
    def test_19_stopped_mid_page_keeps_item_2(self):
        cfg = self.write_config()
        with self.assertRaises(KeyboardInterrupt):
            self.run_pass(cfg, [(0, "One.", ""), (0, "Two.", ""), KeyboardInterrupt()])
        self.assertEqual(self.disk_cursor(), cursor_of(PAGE[1]))
        self.assertEqual(self.posts, ["One.", "Two."])

    def test_20_cursor_saved_before_the_post(self):
        cfg = self.write_config()
        calls = {"n": 0}

        class Boom(Exception):
            pass

        def fake_post(cfg_, item_id, content):
            calls["n"] += 1
            if item_id == "m2":
                raise Boom()
            return True

        with self.assertRaises(Boom):
            self.run_pass(
                cfg, [(0, "One.", ""), (0, "Two.", ""), (0, "Three.", "")],
                extra_patches=[mock.patch.object(antenna, "post_reply", fake_post)],
            )
        self.assertEqual(self.disk_cursor(), cursor_of(PAGE[1]))
        self.assertEqual(calls["n"], 2)

    def test_21_save_failure_is_logged_and_reply_still_posts(self):
        cfg = self.write_config()

        def failing_save(_cfg):
            raise OSError("disk full")

        with self.assertRaises(_Stop):
            self.run_pass(
                cfg, [(0, "One.", "")], pages=[[PAGE[0]]],
                extra_patches=[mock.patch.object(antenna, "save_config", failing_save)],
            )
        lines = [m for m in self.logs if m.startswith("could not save the cursor after m1")]
        self.assertEqual(lines, ["could not save the cursor after m1: disk full"])
        self.assertEqual(self.posts, ["One."])

    def test_22_cursor_never_moves_backwards(self):
        later = cursor_of(PAGE[2]) + 60_000
        cfg = self.write_config({"cursor": later})
        with self.assertRaises(_Stop):
            self.run_pass(cfg, [(0, "One.", "")], pages=[[PAGE[0]]])
        self.assertEqual(self.disk_cursor(), later)
        self.assertEqual(cfg["cursor"], later)


class TestLegacyAndSource(LoopBase):
    def test_23_035_config_loads_and_empty_pass_runs(self):
        cfg = self.write_config({
            "client_version": "0.3.5", "human_paired": True,
            "human_paired_pending": False, "adoption_l1_pending": False,
        })
        self.assertEqual(cfg["client_version"], "0.3.5")
        with self.assertRaises(_Stop):
            self.run_pass(cfg, [], pages=[[]])
        self.assertEqual(len(self.poll_paths), 1)
        self.assertEqual(self.posts, [])
        self.assertEqual(self.disk_cursor(), 123)

    def test_24_source_screen_never_posts_and_signatures_unchanged(self):
        source = ANTENNA_PATH.read_text(encoding="utf-8")
        start = source.index("\ndef screen_reply")
        end = source.index("\ndef ", start + 1)
        self.assertNotIn("post_reply", source[start:end])
        self.assertIn(BASE_SIGNATURES_SOURCE, source)
        self.assertEqual(antenna.INVOKE_ERROR_SIGNATURES, [
            ("contains", "LLM request timed out"),
            ("contains", "Request timed out before a response"),
            ("first_token", "Error:"),
            ("startswith", "Traceback (most recent call last):"),
        ])


if __name__ == "__main__":
    unittest.main()
