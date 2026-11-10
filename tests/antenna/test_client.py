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
    def test_release_check_in_sync_at_032(self):
        out = subprocess.run(
            ["node", "scripts/antenna-release.mjs", "--check"],
            cwd=str(REPO), capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("in sync", out.stdout)
        self.assertIn("0.3.2", out.stdout)


# ─────────────────────────────────────────────────────────────────────────────
# ANTENNA-004 — client 0.3.1
# ─────────────────────────────────────────────────────────────────────────────

class _FakeCompleted:
    def __init__(self, returncode=0, stdout=b"", stderr=b""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


class _FakeActivateResp:
    """A urlopen() context manager that returns a canned activation body."""
    def __init__(self, body):
        self._b = __import__("json").dumps(body).encode("utf-8")

    def read(self):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class TestWindowsInterpreter(unittest.TestCase):
    # item 1 — the service runs pythonw.exe when it is beside python.exe, else
    # falls back to python.exe and says so. Paths are real temp files so .exists()
    # is exercised; sys.executable is pointed at them and restored.
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.d = pathlib.Path(self._tmp.name)
        self._exe = antenna.sys.executable

    def tearDown(self):
        antenna.sys.executable = self._exe
        self._tmp.cleanup()

    def test_pythonw_present_is_chosen(self):
        (self.d / "python.exe").write_text("x")
        (self.d / "pythonw.exe").write_text("x")
        antenna.sys.executable = str(self.d / "python.exe")
        path, fellback = antenna.windows_interpreter()
        self.assertTrue(path.lower().endswith("pythonw.exe"))
        self.assertFalse(fellback)

    def test_pythonw_absent_falls_back(self):
        (self.d / "python.exe").write_text("x")
        antenna.sys.executable = str(self.d / "python.exe")
        path, fellback = antenna.windows_interpreter()
        self.assertTrue(path.lower().endswith("python.exe"))
        self.assertFalse(path.lower().endswith("pythonw.exe"))
        self.assertTrue(fellback)


class TestWindowsServiceFallback(unittest.TestCase):
    # item 2 — when schtasks /Create is refused, install writes the Startup-folder
    # entry, starts the loop now, and status names the mechanism.
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.d = pathlib.Path(self._tmp.name)
        self._env = {k: os.environ.get(k) for k in ("APPDATA", "HIVE_HOME")}
        os.environ["APPDATA"] = str(self.d / "AppData" / "Roaming")
        os.environ["HIVE_HOME"] = str(self.d / ".hive")
        self._exe = antenna.sys.executable
        (self.d / "python.exe").write_text("x")
        antenna.sys.executable = str(self.d / "python.exe")
        self._run = antenna.subprocess.run
        self._start = antenna._start_detached_loop
        self.started = {"n": 0}
        antenna._start_detached_loop = lambda: self.started.__setitem__("n", self.started["n"] + 1)

    def tearDown(self):
        antenna.subprocess.run = self._run
        antenna._start_detached_loop = self._start
        antenna.sys.executable = self._exe
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self._tmp.cleanup()

    def _schtasks_create_denied(self):
        import subprocess as sp

        def fake(cmd, *a, **k):
            if cmd[:2] == ["schtasks", "/Create"]:
                raise sp.CalledProcessError(1, cmd, stderr=b"ERROR: Access is denied.")
            if cmd[:2] == ["schtasks", "/Query"]:
                return _FakeCompleted(returncode=1, stdout=b"")
            if cmd[:2] == ["schtasks", "/Delete"]:
                return _FakeCompleted(returncode=1)
            return _FakeCompleted()

        antenna.subprocess.run = fake

    def test_install_writes_startup_and_starts_now(self):
        self._schtasks_create_denied()
        rc = antenna._service_windows("install")
        self.assertEqual(rc, 0)
        startup = antenna.windows_startup_path()
        self.assertTrue(startup.exists())
        self.assertIn("--run", startup.read_text())
        self.assertEqual(self.started["n"], 1)

    def test_status_names_startup_folder(self):
        self._schtasks_create_denied()
        antenna._service_windows("install")
        import io
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = antenna._service_windows("status")
        out = buf.getvalue()
        self.assertEqual(rc, 0)
        self.assertIn("mechanism: startup-folder", out)
        self.assertIn("running:", out)

    def test_uninstall_removes_startup_entry(self):
        self._schtasks_create_denied()
        antenna._service_windows("install")
        self.assertTrue(antenna.windows_startup_path().exists())
        antenna._service_windows("uninstall")
        self.assertFalse(antenna.windows_startup_path().exists())


class TestJoinDoesEverything(FlightLogBase):
    # item 3 — --join installs the service and appends the memory line; --no-service
    # and --no-memory opt out. Network and cmd_service are stubbed.
    def setUp(self):
        super().setUp()
        self._urlopen = antenna.urllib.request.urlopen
        self._request = antenna.request
        self._cmd_service = antenna.cmd_service
        self._mech = antenna.service_mechanism
        self.svc_calls = []
        antenna.urllib.request.urlopen = lambda req, timeout=None: _FakeActivateResp({
            "agent_id": "a1", "bee_name": "Echo", "inbox": "echo@x",
            "bee_token": "hive_bee_tok_secret", "next_poll_seconds": 60, "cursor": 1000,
        })
        antenna.request = lambda cfg, method, path, payload=None: antenna.HttpResult(200, {}, None, None)
        antenna.cmd_service = lambda action, print_only=False: self.svc_calls.append(action) or 0
        antenna.service_mechanism = lambda: "task"

    def tearDown(self):
        antenna.urllib.request.urlopen = self._urlopen
        antenna.request = self._request
        antenna.cmd_service = self._cmd_service
        antenna.service_mechanism = self._mech
        super().tearDown()

    def _agents_text(self):
        p = pathlib.Path(os.environ["HIVE_AGENTS_FILE"])
        return p.read_text(encoding="utf-8") if p.exists() else ""

    def test_join_installs_service_and_appends_memory(self):
        rc = antenna.cmd_join("hive_join_tok", "https://example.invalid", "command", None)
        self.assertEqual(rc, 0)
        self.assertIn("install", self.svc_calls)
        self.assertIn(antenna.memory_line(), self._agents_text())

    def test_no_service_opts_out(self):
        rc = antenna.cmd_join("hive_join_tok", "https://example.invalid", "command", None, no_service=True)
        self.assertEqual(rc, 0)
        self.assertEqual(self.svc_calls, [])
        self.assertIn(antenna.memory_line(), self._agents_text())

    def test_no_memory_opts_out(self):
        rc = antenna.cmd_join("hive_join_tok", "https://example.invalid", "command", None, no_memory=True)
        self.assertEqual(rc, 0)
        self.assertIn("install", self.svc_calls)
        self.assertNotIn(antenna.memory_line(), self._agents_text())


class TestSkillRefresh(FlightLogBase):
    # item 4 — refresh on marker mismatch with a backup; no refresh on match;
    # SOUL-LAYER.md untouched; client_version updated.
    def _write_skill(self, text):
        p = antenna.skill_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def test_refresh_on_mismatch_backs_up_and_leaves_soul(self):
        self.write_config()
        self._write_skill("old skill text\n<!-- antenna-skill 0.3.0 -->\n")
        soul = antenna.layer_path()
        soul.write_text("MY SOUL LAYER", encoding="utf-8")
        wrote = antenna.refresh_skill_md(antenna.load_config())
        self.assertTrue(wrote)
        self.assertIn("antenna-skill 0.3.2", antenna.skill_path().read_text(encoding="utf-8"))
        backup = antenna.skill_path().parent / "SKILL-0.3.0.bak.md"
        self.assertTrue(backup.exists())
        self.assertIn("old skill text", backup.read_text(encoding="utf-8"))
        # SOUL-LAYER.md is never touched by the refresh.
        self.assertEqual(soul.read_text(encoding="utf-8"), "MY SOUL LAYER")

    def test_no_refresh_when_marker_matches(self):
        self.write_config()
        self._write_skill(antenna.SKILL_MD)
        wrote = antenna.refresh_skill_md(antenna.load_config())
        self.assertFalse(wrote)
        self.assertEqual(list(antenna.skill_path().parent.glob("SKILL-*.bak.md")), [])

    def test_missing_skill_is_written(self):
        self.write_config()
        wrote = antenna.refresh_skill_md(antenna.load_config())
        self.assertTrue(wrote)
        self.assertIn("antenna-skill 0.3.2", antenna.skill_path().read_text(encoding="utf-8"))

    def test_refresh_updates_client_version(self):
        self.write_config()  # written at 0.2.2
        self._write_skill("old\n<!-- antenna-skill 0.3.0 -->\n")
        antenna.refresh_skill_md(antenna.load_config())
        self.assertEqual(antenna.load_config().get("client_version"), "0.3.2")


class TestInvokeError(unittest.TestCase):
    # item 5 — each invoke-error case yields no reply (InvokeError); a good reply
    # is returned; openclaw keeps its old non-zero-exit behavior (Unreachable).
    def _cfg(self, mode="command"):
        return {"mode": mode, "invoke": {"command": ["x"], "timeout_seconds": 5}}

    def _patch_run(self, ret):
        self._orig = antenna._run_invoke
        antenna._run_invoke = lambda cfg, framed: ret

    def tearDown(self):
        if hasattr(self, "_orig"):
            antenna._run_invoke = self._orig

    def test_empty_reply(self):
        self._patch_run((0, "   ", ""))
        with self.assertRaises(antenna.InvokeError):
            antenna.deliver(self._cfg(), {"content": "hi"})

    def test_timeout_signature(self):
        self._patch_run((0, "LLM request timed out after 30s", ""))
        with self.assertRaises(antenna.InvokeError):
            antenna.deliver(self._cfg(), {"content": "hi"})

    def test_request_timed_out_signature(self):
        self._patch_run((0, "Request timed out before a response was generated", ""))
        with self.assertRaises(antenna.InvokeError):
            antenna.deliver(self._cfg(), {"content": "hi"})

    def test_error_first_token(self):
        self._patch_run((0, "Error: something broke", ""))
        with self.assertRaises(antenna.InvokeError):
            antenna.deliver(self._cfg(), {"content": "hi"})

    def test_python_traceback(self):
        self._patch_run((0, "Traceback (most recent call last):\n  File a.py", ""))
        with self.assertRaises(antenna.InvokeError):
            antenna.deliver(self._cfg(), {"content": "hi"})

    def test_nonzero_exit(self):
        self._patch_run((1, "", "boom"))
        with self.assertRaises(antenna.InvokeError):
            antenna.deliver(self._cfg(), {"content": "hi"})

    def test_good_reply_is_returned(self):
        self._patch_run((0, "a real answer", ""))
        self.assertEqual(antenna.deliver(self._cfg(), {"content": "hi"}), "a real answer")

    def test_error_word_not_at_start_is_fine(self):
        # "Error:" only trips as the FIRST token; a sentence mentioning it posts.
        self._patch_run((0, "No error: the build is green", ""))
        self.assertEqual(
            antenna.deliver(self._cfg(), {"content": "hi"}), "No error: the build is green"
        )

    def test_openclaw_nonzero_is_unreachable_not_invoke_error(self):
        self._patch_run((1, "", "boom"))
        with self.assertRaises(antenna.Unreachable):
            antenna.deliver(self._cfg(mode="openclaw"), {"content": "hi"})
        try:
            antenna.deliver(self._cfg(mode="openclaw"), {"content": "hi"})
        except antenna.InvokeError:
            self.fail("openclaw non-zero exit must be Unreachable, not InvokeError")
        except antenna.Unreachable:
            pass


class TestInvokeErrorInLoop(FlightLogBase):
    # item 5 — the loop logs `invoke error:` and the next heartbeat carries
    # invoke_error:{n}.
    class _Stop(Exception):
        pass

    def test_loop_logs_and_flags(self):
        self.write_config({"client_version": "0.3.1"})
        cfg = antenna.load_config()
        logs = []
        flags_seen = {"f": None}

        orig = {
            "log": antenna.log, "request": antenna.request, "run": antenna._run_invoke,
            "hb": antenna.heartbeat, "sleep": antenna.time.sleep,
            "every": antenna.HEARTBEAT_EVERY_TICKS,
        }
        antenna.HEARTBEAT_EVERY_TICKS = 1
        antenna.log = lambda m: logs.append(m)

        def fake_request(cfg, method, path, payload=None):
            if path.startswith("/api/bee/poll"):
                return antenna.HttpResult(200, {"items": [{
                    "id": "1", "posted_at": "2026-11-07T00:00:00.000Z", "type": "chamber",
                    "from": "x", "from_type": "bee", "content": "hi",
                }]}, None, None)
            return antenna.HttpResult(200, {}, None, None)

        antenna.request = fake_request
        antenna._run_invoke = lambda cfg, framed: (0, "", "")  # empty -> invoke error

        def fake_hb(cfg, flags):
            flags_seen["f"] = list(flags)
            return {}

        antenna.heartbeat = fake_hb

        def fake_sleep(_s):
            raise self._Stop()

        antenna.time.sleep = fake_sleep
        try:
            with self.assertRaises(self._Stop):
                antenna.run_loop(cfg)
        finally:
            antenna.log = orig["log"]
            antenna.request = orig["request"]
            antenna._run_invoke = orig["run"]
            antenna.heartbeat = orig["hb"]
            antenna.time.sleep = orig["sleep"]
            antenna.HEARTBEAT_EVERY_TICKS = orig["every"]

        self.assertTrue(any("invoke error:" in m for m in logs))
        self.assertIn("invoke_error:1", flags_seen["f"])


class TestLegacyConfig030(FlightLogBase):
    class _Stop(Exception):
        pass

    def test_030_config_loads_and_loop_runs(self):
        # A 0.3.0 hive.json: the fields 0.3.0 wrote, including the pairing state.
        self.write_config({
            "client_version": "0.3.0", "human_paired": True,
            "human_paired_pending": False, "adoption_l1_pending": False,
        })
        cfg = antenna.load_config()
        self.assertEqual(cfg["client_version"], "0.3.0")
        self.assertTrue(cfg.get("human_paired"))

        calls = {"n": 0}

        def fake_request(cfg, method, path, payload=None):
            calls["n"] += 1
            return antenna.HttpResult(200, {"items": [], "cursor": int(cfg.get("cursor", 0))}, None, None)

        orig_request = antenna.request
        orig_sleep = antenna.time.sleep
        antenna.request = fake_request

        def fake_sleep(_seconds):
            raise self._Stop()

        antenna.time.sleep = fake_sleep
        try:
            with self.assertRaises(self._Stop):
                antenna.run_loop(cfg)
        finally:
            antenna.request = orig_request
            antenna.time.sleep = orig_sleep
        self.assertGreaterEqual(calls["n"], 1)


# ─────────────────────────────────────────────────────────────────────────────
# ANTENNA-005 — client 0.3.2: status by inspection, uninstall stops the loop,
# the task XML with no time limit, the --always attempt.
# ─────────────────────────────────────────────────────────────────────────────
import contextlib
import io
import subprocess as _sp


class ServiceInspectionBase(FlightLogBase):
    """A temp HIVE_HOME plus APPDATA and XDG_CONFIG_HOME under it, so mechanism
    detection (Startup .cmd, systemd unit, pid file) never touches the real host.
    subprocess.run is saved and restored so each test installs its own schtasks."""

    def setUp(self):
        super().setUp()
        self._saved = {k: os.environ.get(k) for k in ("APPDATA", "XDG_CONFIG_HOME")}
        os.environ["APPDATA"] = str(self.home / "AppData" / "Roaming")
        os.environ["XDG_CONFIG_HOME"] = str(self.home / ".config")
        self._run = antenna.subprocess.run

    def tearDown(self):
        antenna.subprocess.run = self._run
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        super().tearDown()

    def _status(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = antenna._service_status()
        return rc, buf.getvalue()

    def _write_startup(self):
        p = antenna.windows_startup_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("@echo off\r\n", encoding="utf-8")


class TestStatusByInspection(ServiceInspectionBase):
    def _schtasks(self, query_rc=1, xml=b""):
        def fake(cmd, *a, **k):
            if cmd[:2] == ["schtasks", "/Query"]:
                if "/XML" in cmd:
                    return _FakeCompleted(returncode=(0 if query_rc == 0 else 1), stdout=xml)
                return _FakeCompleted(returncode=query_rc)
            return _FakeCompleted()
        antenna.subprocess.run = fake

    def test_startup_folder_when_task_query_fails_and_cmd_exists(self):
        self._schtasks(query_rc=1)
        self._write_startup()
        rc, out = self._status()
        self.assertEqual(rc, 0)
        self.assertIn("mechanism: startup-folder", out)
        self.assertNotIn("warning:", out)

    def test_task_when_query_succeeds(self):
        self._schtasks(query_rc=0, xml=b"<Task><LogonType>InteractiveToken</LogonType></Task>")
        rc, out = self._status()
        self.assertEqual(rc, 0)
        self.assertIn("mechanism: task", out)
        self.assertNotIn("task (always)", out)
        self.assertNotIn("startup-folder", out)

    def test_both_mechanisms_warn(self):
        self._schtasks(query_rc=0, xml=b"<Task></Task>")
        self._write_startup()
        rc, out = self._status()
        self.assertEqual(rc, 0)
        self.assertIn("mechanism: task, startup-folder", out)
        self.assertIn("warning: two mechanisms installed; run service install to leave one", out)

    def test_none_when_nothing_installed(self):
        self._schtasks(query_rc=1)
        rc, out = self._status()
        self.assertEqual(rc, 1)
        self.assertIn("installed: no", out)
        self.assertIn("mechanism: none", out)


class TestRunningState(ServiceInspectionBase):
    def test_running_yes_with_pid_for_live_antenna(self):
        antenna.subprocess.run = lambda *a, **k: _FakeCompleted(returncode=1)
        antenna.pid_path().write_text("4242\n", encoding="utf-8")
        orig = antenna._process_cmdline
        antenna._process_cmdline = lambda pid: "python3 /x/antenna.py --run"
        try:
            state, pid = antenna.running_state()
            self.assertEqual((state, pid), ("yes", 4242))
            rc, out = self._status()
        finally:
            antenna._process_cmdline = orig
        self.assertIn("running: yes", out)
        self.assertIn("pid: 4242", out)

    def test_stale_pid_file_is_reported_and_removed(self):
        antenna.subprocess.run = lambda *a, **k: _FakeCompleted(returncode=1)
        antenna.pid_path().write_text("4242\n", encoding="utf-8")
        orig = antenna._process_cmdline
        antenna._process_cmdline = lambda pid: None  # no such process
        try:
            state, pid = antenna.running_state()
            self.assertEqual(state, "stale")
            self.assertFalse(antenna.pid_path().exists())
            # re-create it to exercise the status wording too
            antenna.pid_path().write_text("4242\n", encoding="utf-8")
            rc, out = self._status()
        finally:
            antenna._process_cmdline = orig
        self.assertIn("running: no (stale pid file removed)", out)
        self.assertFalse(antenna.pid_path().exists())


class TestStopLoops(FlightLogBase):
    def test_finds_two_kills_both_returns_two(self):
        calls = {"n": 0}

        def fake_live():
            calls["n"] += 1
            return [111, 222] if calls["n"] == 1 else []

        killed = []
        orig_live, orig_kill = antenna._live_run_processes, antenna._kill
        antenna._live_run_processes = fake_live
        antenna._kill = lambda p: killed.append(p)
        try:
            n = antenna.stop_loops()
        finally:
            antenna._live_run_processes, antenna._kill = orig_live, orig_kill
        self.assertEqual(n, 2)
        self.assertEqual(sorted(killed), [111, 222])

    def test_live_run_processes_excludes_self(self):
        me = os.getpid()
        out = (f"  {me} python3 /x/antenna.py --run\n"
               "  4242 python3 /y/antenna.py --run\n"
               "  99 bash -lc something\n").encode()
        orig = antenna.subprocess.run
        antenna.subprocess.run = lambda *a, **k: _FakeCompleted(returncode=0, stdout=out)
        try:
            pids = antenna._live_run_processes()
        finally:
            antenna.subprocess.run = orig
        self.assertIn(4242, pids)
        self.assertNotIn(me, pids)


class TestWindowsUninstallBoth(ServiceInspectionBase):
    def test_uninstall_removes_task_and_startup(self):
        self._write_startup()

        def fake(cmd, *a, **k):
            if cmd[:2] == ["schtasks", "/Delete"]:
                return _FakeCompleted(returncode=0)  # a task is present and removed
            return _FakeCompleted()  # /End, and ps for stop_loops -> empty

        antenna.subprocess.run = fake
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = antenna._service_windows("uninstall")
        out = buf.getvalue()
        self.assertEqual(rc, 0)
        self.assertIn("removed: task, startup-folder", out)
        self.assertFalse(antenna.windows_startup_path().exists())


class TestWindowsInstallStopsFirst(ServiceInspectionBase):
    def test_install_calls_stop_loops_before_installing(self):
        order = []
        orig = {
            "stop": antenna.stop_loops,
            "remove": antenna._windows_remove_mechanisms,
            "install": antenna._windows_install_task,
        }
        antenna.stop_loops = lambda: order.append("stop") or 0
        antenna._windows_remove_mechanisms = lambda: order.append("remove") or []
        antenna._windows_install_task = (
            lambda always=False: order.append("install")
            or (True, "created Task Scheduler task Antenna from XML (task)")
        )
        try:
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = antenna._service_windows("install")
        finally:
            antenna.stop_loops = orig["stop"]
            antenna._windows_remove_mechanisms = orig["remove"]
            antenna._windows_install_task = orig["install"]
        self.assertEqual(rc, 0)
        self.assertIn("stop", order)
        self.assertIn("install", order)
        self.assertLess(order.index("stop"), order.index("install"))
        self.assertIn("installed: task", buf.getvalue())


class TestTaskXML(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.d = pathlib.Path(self._tmp.name)
        self._exe = antenna.sys.executable
        (self.d / "python.exe").write_text("x")
        (self.d / "pythonw.exe").write_text("x")
        antenna.sys.executable = str(self.d / "python.exe")

    def tearDown(self):
        antenna.sys.executable = self._exe
        self._tmp.cleanup()

    def test_xml_carries_the_settings_schtasks_flags_dropped(self):
        xml = antenna.windows_task_xml_text()
        self.assertIn("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>", xml)
        self.assertIn("<DisallowStartIfOnBatteries>false", xml)
        self.assertIn("<StopIfGoingOnBatteries>false", xml)
        self.assertIn("<RestartOnFailure>", xml)
        self.assertIn("<Count>3</Count>", xml)
        self.assertIn("<Interval>PT1M</Interval>", xml)
        self.assertIn("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>", xml)
        self.assertIn("<LogonTrigger>", xml)
        self.assertIn("<Hidden>true</Hidden>", xml)
        self.assertIn("pythonw.exe", xml)
        self.assertIn("--run", xml)
        self.assertNotIn("<LogonType>Password</LogonType>", xml)

    def test_always_xml_uses_password_logon(self):
        xml = antenna.windows_task_xml_text(always=True)
        self.assertIn("<LogonType>Password</LogonType>", xml)


class TestWindowsInstallXML(ServiceInspectionBase):
    def setUp(self):
        super().setUp()
        self._exe = antenna.sys.executable
        (self.home / "python.exe").write_text("x")
        (self.home / "pythonw.exe").write_text("x")
        antenna.sys.executable = str(self.home / "python.exe")
        self._start = antenna._start_detached_loop
        self.started = {"n": 0}
        antenna._start_detached_loop = lambda: self.started.__setitem__("n", self.started["n"] + 1)

    def tearDown(self):
        antenna.sys.executable = self._exe
        antenna._start_detached_loop = self._start
        super().tearDown()

    def test_xml_refusal_falls_back_to_startup_folder(self):
        def fake(cmd, *a, **k):
            if cmd[:2] == ["schtasks", "/Create"]:
                raise _sp.CalledProcessError(1, cmd, stderr=b"ERROR: Access is denied.")
            if cmd[:2] == ["schtasks", "/Delete"]:
                return _FakeCompleted(returncode=1)
            return _FakeCompleted()  # /End, /Query, ps

        antenna.subprocess.run = fake
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = antenna._service_windows("install")
        self.assertEqual(rc, 0)
        self.assertTrue(antenna.windows_startup_path().exists())
        self.assertIn("--run", antenna.windows_startup_path().read_text())
        self.assertEqual(self.started["n"], 1)
        self.assertIn("installed: startup-folder", buf.getvalue())

    def test_always_refusal_prints_plain_line_and_installs_logon_task(self):
        def fake(cmd, *a, **k):
            if cmd[:2] == ["schtasks", "/Create"]:
                if "/RP" in cmd:  # the --always (password) attempt is refused
                    raise _sp.CalledProcessError(1, cmd, stderr=b"ERROR: Access is denied.")
                return _FakeCompleted(returncode=0)  # the plain logon task succeeds
            return _FakeCompleted()

        antenna.subprocess.run = fake
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = antenna._service_windows("install", always=True)
        out = buf.getvalue()
        self.assertEqual(rc, 0)
        self.assertIn("always-on needs an elevated prompt on this computer; installed the logon task instead", out)
        self.assertIn("installed: task", out)
        self.assertFalse(antenna.windows_startup_path().exists())


class TestLegacyConfig031(FlightLogBase):
    class _Stop(Exception):
        pass

    def test_031_config_loads_and_loop_runs(self):
        self.write_config({
            "client_version": "0.3.1", "human_paired": True,
            "human_paired_pending": False, "adoption_l1_pending": False,
        })
        cfg = antenna.load_config()
        self.assertEqual(cfg["client_version"], "0.3.1")

        calls = {"n": 0}

        def fake_request(cfg, method, path, payload=None):
            calls["n"] += 1
            return antenna.HttpResult(200, {"items": [], "cursor": int(cfg.get("cursor", 0))}, None, None)

        orig_request = antenna.request
        orig_sleep = antenna.time.sleep
        antenna.request = fake_request

        def fake_sleep(_seconds):
            raise self._Stop()

        antenna.time.sleep = fake_sleep
        try:
            with self.assertRaises(self._Stop):
                antenna.run_loop(cfg)
        finally:
            antenna.request = orig_request
            antenna.time.sleep = orig_sleep
        self.assertGreaterEqual(calls["n"], 1)
        # item 1 — the running loop recorded its own pid for status to read.
        self.assertTrue(antenna.pid_path().exists())


if __name__ == "__main__":
    unittest.main()
