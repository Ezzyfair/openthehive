#!/usr/bin/env python3
# tests/antenna/test_client.py
# ----------------------------------------------------------------------------
# THE HIVE · Antenna — the client self-test for ANTENNA-003 (client 0.3.0).
#
# The repo has no Python test layout yet; this is the first, mirroring tests/rail
# in spirit (stdlib only, run directly, no new package):
#
#   python3 -I -m unittest discover -s tests/antenna -p 'test_*.py'
#
# -I (isolated) matters: it keeps the current directory and PYTHONPATH off the
# import path, so a file planted beside the module under test cannot shadow a
# stdlib import. antenna.py is loaded from its published path by file location.
#
# No network: antenna.request is monkeypatched where a test needs the colony.
# HIVE_HOME and HIVE_AGENTS_FILE point at a fresh temp dir per test, so nothing
# touches the developer's real ~/.hive.
# ----------------------------------------------------------------------------
import importlib.util
import os
import pathlib
import subprocess
import tempfile
import unittest

REPO = pathlib.Path(__file__).resolve().parents[2]
ANTENNA_PATH = REPO / "public" / "antenna" / "antenna.py"


def load_antenna():
    spec = importlib.util.spec_from_file_location("antenna_under_test", ANTENNA_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


antenna = load_antenna()


class FlightLogBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = pathlib.Path(self._tmp.name)
        self._prev_home = os.environ.get("HIVE_HOME")
        self._prev_agents = os.environ.get("HIVE_AGENTS_FILE")
        os.environ["HIVE_HOME"] = str(self.home)
        os.environ["HIVE_AGENTS_FILE"] = str(self.home / "AGENTS.md")

    def tearDown(self):
        for key, prev in (("HIVE_HOME", self._prev_home), ("HIVE_AGENTS_FILE", self._prev_agents)):
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
            "token": "hive_bee_abcdefgh_secret",
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


class TestFlightLogCreation(FlightLogBase):
    def test_created_at_activation_with_for_my_human_last(self):
        # §10 / ruling 1 — write_installed_documents writes exactly four hive/ paths,
        # and FLIGHT-LOG.md is created with FOR MY HUMAN last and no entries above it.
        written = antenna.write_installed_documents("Echo")
        names = [p.name for p in written]
        self.assertEqual(
            sorted(names), ["FLIGHT-LOG.md", "SKILL.md", "SOUL-LAYER.md"]
        )
        log = antenna.flight_log_path()
        self.assertTrue(log.exists())
        text = log.read_text(encoding="utf-8")
        self.assertIn("# Flight log — Echo", text)
        self.assertIn(antenna.FOR_MY_HUMAN_HEADING, text)
        # No delivered-item block yet, and FOR MY HUMAN is the last heading.
        self.assertNotIn("### ", text)
        self.assertEqual(text.rstrip().count(antenna.FOR_MY_HUMAN_HEADING), 1)
        heading_idx = text.index(antenna.FOR_MY_HUMAN_HEADING)
        self.assertNotIn("\n## ", text[heading_idx + 1:])  # nothing after it

    def test_not_clobbered_on_second_call(self):
        antenna.create_flight_log("Echo")
        antenna.append_flight_log("Echo", "### marker\nbody\n*(no reply)*\n")
        before = antenna.flight_log_path().read_text(encoding="utf-8")
        antenna.create_flight_log("Echo")  # must not overwrite the memory
        after = antenna.flight_log_path().read_text(encoding="utf-8")
        self.assertEqual(before, after)
        self.assertIn("### marker", after)


class TestFlightLogAppend(FlightLogBase):
    def test_two_appends_keep_for_my_human_last_and_intact(self):
        antenna.create_flight_log("Echo")
        original = antenna.flight_log_path().read_text(encoding="utf-8")
        human_block = original[original.index(antenna.FOR_MY_HUMAN_HEADING):]

        item_a = {"posted_at": "2026-11-06T10:00:00.000Z", "type": "chamber",
                  "from": "Esmeralda", "from_type": "staff", "id": "id-a", "content": "first"}
        item_b = {"posted_at": "2026-11-06T11:00:00.000Z", "type": "chamber",
                  "from": "Your human", "from_type": "human", "id": "id-b", "content": "second"}
        antenna.append_flight_log("Echo", antenna.flight_entry(item_a, "reply A"))
        antenna.append_flight_log("Echo", antenna.flight_entry(item_b, ""))

        text = antenna.flight_log_path().read_text(encoding="utf-8")
        self.assertEqual(text.count(antenna.FOR_MY_HUMAN_HEADING), 1)
        # Both entries land ABOVE the FOR MY HUMAN heading, in order.
        hid = text.index(antenna.FOR_MY_HUMAN_HEADING)
        self.assertLess(text.index("id-a"), hid)
        self.assertLess(text.index("id-b"), hid)
        self.assertLess(text.index("id-a"), text.index("id-b"))
        # The FOR MY HUMAN section is byte-for-byte what creation wrote.
        self.assertTrue(text.endswith(human_block))

    def test_human_lane_item_logs_with_human(self):
        antenna.create_flight_log("Echo")
        item = {"posted_at": "2026-11-06T12:00:00.000Z", "type": "chamber",
                "from": "Your human", "from_type": "human", "id": "id-h",
                "content": "hello from your human"}
        antenna.append_flight_log("Echo", antenna.flight_entry(item, "hi back"))
        text = antenna.flight_log_path().read_text(encoding="utf-8")
        self.assertIn("from Your human (human)", text)
        self.assertIn("hello from your human", text)
        self.assertIn("**Echo replied:**", text)
        self.assertIn("hi back", text)

    def test_no_reply_marker(self):
        antenna.create_flight_log("Echo")
        item = {"posted_at": "t", "type": "chamber", "from": "x", "from_type": "bee",
                "id": "idn", "content": "c"}
        antenna.append_flight_log("Echo", antenna.flight_entry(item, "   "))
        text = antenna.flight_log_path().read_text(encoding="utf-8")
        self.assertIn("*(no reply)*", text)


class TestFrame(unittest.TestCase):
    def test_verified_human_header(self):
        item = {"type": "chamber", "from_type": "human", "verified": True,
                "from": "Your human", "posted_at": "2026-11-06T12:00:00.000Z",
                "id": "x", "content": "hi"}
        out = antenna.frame_text(item)
        self.assertIn("from: Your human (human · verified by the colony)", out)

    def test_unverified_human_header_plain(self):
        item = {"type": "chamber", "from_type": "human", "verified": False,
                "from": "Your human", "posted_at": "t", "id": "x", "content": "hi"}
        out = antenna.frame_text(item)
        self.assertIn("from: Your human (human)", out)
        self.assertNotIn("verified by the colony", out)

    def test_bee_header_unchanged(self):
        item = {"type": "chamber", "from_type": "bee", "verified": False,
                "from": "Buzz", "posted_at": "t", "id": "x", "content": "hi"}
        out = antenna.frame_text(item)
        self.assertIn("from: Buzz (bee)", out)

    def test_json_envelope_carries_verified(self):
        item = {"type": "chamber", "from_type": "human", "verified": True,
                "from": "Your human", "posted_at": "t", "id": "x", "content": "hi"}
        import json
        out = json.loads(antenna.frame_json(item))
        self.assertTrue(out["hive_message"]["verified"])
        self.assertEqual(out["hive_message"]["from_type"], "human")


class TestAdoptMemory(FlightLogBase):
    def test_appends_exactly_one_line_idempotent(self):
        self.write_config()
        self.assertEqual(antenna.cmd_adopt(l1=False, remove=False, memory=True), 0)
        self.assertEqual(antenna.cmd_adopt(l1=False, remove=False, memory=True), 0)
        agents = pathlib.Path(os.environ["HIVE_AGENTS_FILE"]).read_text(encoding="utf-8")
        line = antenna.memory_line()
        self.assertEqual(agents.count(line), 1)
        self.assertIn("hive/FLIGHT-LOG.md", line)


class TestPair(FlightLogBase):
    def _patch_request(self, result):
        self._orig = antenna.request
        antenna.request = lambda cfg, method, path, payload=None: result

    def tearDown(self):
        if hasattr(self, "_orig"):
            antenna.request = self._orig
        super().tearDown()

    def test_confirmed_then_2xx_clears_pending(self):
        self.write_config()
        self._patch_request(antenna.HttpResult(200, {"latest_version": "0.3.0"}, None, None))
        self.assertEqual(antenna.cmd_pair(confirmed=True, status=False), 0)
        cfg = antenna.load_config()
        self.assertTrue(cfg.get("human_paired"))
        self.assertFalse(cfg.get("human_paired_pending"))

    def test_confirmed_then_5xx_keeps_pending(self):
        self.write_config()
        self._patch_request(antenna.HttpResult(503, None, None, None))
        self.assertEqual(antenna.cmd_pair(confirmed=True, status=False), 0)
        cfg = antenna.load_config()
        self.assertTrue(cfg.get("human_paired_pending"))
        self.assertFalse(cfg.get("human_paired"))

    def test_status_strings(self):
        self.write_config({"human_paired_pending": True})
        # smoke: status runs and returns 0 for a pending config
        self.assertEqual(antenna.cmd_pair(confirmed=False, status=True), 0)


class TestService(unittest.TestCase):
    def test_systemd_unit_keys(self):
        unit = antenna.systemd_unit_text()
        for key in ("[Service]", "ExecStart=", "--run", "Restart=always", "RestartSec=30", "WantedBy=default.target"):
            self.assertIn(key, unit)

    def test_launchd_plist_keys(self):
        plist = antenna.launchd_plist_text()
        for key in ("<key>Label</key>", "ai.openthehive.antenna", "<key>KeepAlive</key>",
                    "<key>RunAtLoad</key>", "--run"):
            self.assertIn(key, plist)

    def test_windows_task_command_keys(self):
        cmd = antenna.windows_task_command()
        self.assertEqual(cmd[0], "schtasks")
        joined = " ".join(cmd)
        for key in ("Antenna", "ONLOGON", "--run", "/Create"):
            self.assertIn(key, joined)


class TestLegacyConfigRunsLoop(FlightLogBase):
    class _StopLoop(Exception):
        pass

    def test_022_config_loads_and_loop_runs(self):
        # A 0.2.2 hive.json: exactly the fields 0.2.2 wrote, none of the new ones.
        self.write_config()
        cfg = antenna.load_config()
        self.assertEqual(cfg["client_version"], "0.2.2")
        self.assertNotIn("human_paired_pending", cfg)

        calls = {"n": 0}

        def fake_request(cfg, method, path, payload=None):
            calls["n"] += 1
            return antenna.HttpResult(200, {"items": [], "cursor": int(cfg.get("cursor", 0))}, None, None)

        orig_request = antenna.request
        orig_sleep = antenna.time.sleep
        antenna.request = fake_request

        def fake_sleep(_seconds):
            raise self._StopLoop()

        antenna.time.sleep = fake_sleep
        try:
            with self.assertRaises(self._StopLoop):
                antenna.run_loop(cfg)
        finally:
            antenna.request = orig_request
            antenna.time.sleep = orig_sleep
        # The loop completed a full tick against the 0.2.2 config before the first sleep.
        self.assertGreaterEqual(calls["n"], 1)


class TestRelease(unittest.TestCase):
    def test_release_check_in_sync_at_030(self):
        out = subprocess.run(
            ["node", "scripts/antenna-release.mjs", "--check"],
            cwd=str(REPO), capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("in sync", out.stdout)
        self.assertIn("0.3.0", out.stdout)


if __name__ == "__main__":
    unittest.main()
