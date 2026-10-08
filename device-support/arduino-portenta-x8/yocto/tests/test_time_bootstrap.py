"""Exercise clock recovery and first login without touching host time or network."""

import os
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import unittest


LAYER = Path(__file__).resolve().parents[1] / 'meta-normacore-x8'
SYNC = LAYER / 'recipes-core/x8-timesync/files/x8-timesync'
LOGIN = (LAYER / 'recipes-connectivity/x8-tailscale-autologin/files/'
         'x8-tailscale-autologin')
RECIPE = LAYER / 'recipes-core/images/x8-normacore.bb'


class TimeBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('etc/default', 'var/log', 'run'):
            (self.root / name).mkdir(parents=True)
        self.events_path = self.root / 'events'
        self.env = dict(os.environ, EVENT_LOG=str(self.events_path))
        self.timestamp = self.root / 'etc/timestamp'
        self.timestamp.write_text('20261006120000\n')
        self.done = self.root / 'var/lib/tailscale/x8-autologin.done'
        (self.root / 'etc/default/x8-tailscale-autologin').write_text(
            'X8_TAILSCALE_AUTHKEY="test-only-key"\n'
            'X8_TAILSCALE_HOSTNAME="rover-alpha"\n'
            'X8_TAILSCALE_LOGIN_SERVER="https://headscale.example.test"\n')

    def execute(self, source, mocks, *args):
        content = source.read_text()
        for prefix in ('/etc/', '/var/', '/run'):
            content = content.replace(prefix, str(self.root) + prefix)
        script = self.root / source.name
        script.write_text(content)
        wrapper = mocks + '\nscript=$1\nshift\n. "$script"\n'
        return subprocess.run(['sh', '-c', wrapper, 'test', str(script), *args],
                              env=self.env, capture_output=True, text=True, timeout=5)

    def events(self):
        return self.events_path.read_text().splitlines()

    def test_late_cellular_refreshes_dns_before_saving_synchronized_time(self):
        result = self.execute(SYNC, '''
phase=0
synced=0
chronyc() {
    echo "chronyc $*" >> "$EVENT_LOG"
    case "$*" in
        *waitsync*) [ "$synced" = 1 ] ;;
        'burst 4/4') synced=1 ;;
    esac
}
ip() { [ "$phase" = 1 ] && echo 'default dev ppp0'; }
sleep() {
    echo "sleep $*" >> "$EVENT_LOG"
    case "$1" in 10) phase=1 ;; 3600) exit 0 ;; *) exit 99 ;; esac
}
date() {
    case "$*" in
        '-u +%Y%m%d%H%M%S') echo 20261006123456 ;;
        *) command date "$@" ;;
    esac
}
hwclock() { echo "hwclock $*" >> "$EVENT_LOG"; return 1; }
ntpd() { exit 98; }
''')
        self.assertEqual(result.returncode, 0, result.stderr)
        events = self.events()
        self.assertLess(events.index('sleep 10'), events.index('chronyc refresh'))
        self.assertLess(events.index('chronyc refresh'), events.index('chronyc burst 4/4'))
        self.assertLess(events.index('chronyc burst 4/4'),
                        events.index('hwclock --systohc --utc'))
        self.assertEqual(self.timestamp.read_text(), '20261006123456\n')
        self.assertTrue((self.root / 'run/x8-time-sync.status').exists())
        self.assertIn('hardware clock unavailable',
                      (self.root / 'var/log/x8-timesync.log').read_text())

    def test_unsynchronized_ntp_never_overwrites_boot_timestamp(self):
        result = self.execute(SYNC, '''
chronyc() { echo "chronyc $*" >> "$EVENT_LOG"; return 1; }
ip() { echo 'default dev ppp0'; }
sleep() { echo "sleep $*" >> "$EVENT_LOG"; exit 0; }
hwclock() { echo unexpected-rtc-write >> "$EVENT_LOG"; }
ntpd() { exit 98; }
''')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('chronyc refresh', self.events())
        self.assertIn('sleep 30', self.events())
        self.assertNotIn('unexpected-rtc-write', self.events())
        self.assertEqual(self.timestamp.read_text(), '20261006120000\n')
        self.assertFalse((self.root / 'run/x8-time-sync.status').exists())

    def test_login_waits_for_time_and_retries_failed_bounded_untagged_login(self):
        result = self.execute(LOGIN, '''
synced=0
attempts=0
chronyc() { echo "chronyc $*" >> "$EVENT_LOG"; [ "$synced" = 1 ]; }
sleep() { echo "sleep $*" >> "$EVENT_LOG"; synced=1; }
tailscale() {
    case "$1" in
        status) echo 'Logged out.'; return 1 ;;
        up)
            echo "tailscale $*" >> "$EVENT_LOG"
            attempts=$((attempts + 1))
            [ "$attempts" -eq 2 ] ;;
        *) return 99 ;;
    esac
}
update-rc.d() { echo "disable $*" >> "$EVENT_LOG"; }
''', 'run')
        self.assertEqual(result.returncode, 0, result.stderr)
        events = self.events()
        attempts = [event for event in events if event.startswith('tailscale up ')]
        self.assertEqual(len(attempts), 2)
        self.assertLess(events.index('sleep 30'), events.index(attempts[0]))
        for attempt in attempts:
            self.assertIn('--timeout=30s', attempt)
            self.assertIn('--hostname=rover-alpha', attempt)
            self.assertIn('--accept-dns=false', attempt)
            self.assertNotIn('--advertise-tags', attempt)
        self.assertTrue(self.done.exists())
        log = (self.root / 'var/log/x8-tailscale-autologin.log').read_text()
        self.assertIn('login deferred', log)
        self.assertIn('tailscale up failed', log)
        self.assertIn('authenticated successfully', log)

    def test_unsynced_clock_does_not_attempt_login_or_mark_done(self):
        result = self.execute(LOGIN, '''
chronyc() { return 1; }
sleep() { echo 'deferred' >> "$EVENT_LOG"; exit 0; }
tailscale() {
    case "$1" in
        status) echo 'Logged out.'; return 1 ;;
        *) echo unexpected-login >> "$EVENT_LOG"; return 0 ;;
    esac
}
update-rc.d() { echo unexpected-disable >> "$EVENT_LOG"; }
''', 'run')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events(), ['deferred'])
        self.assertFalse(self.done.exists())

    def test_failed_login_does_not_mark_done_or_disable_retry_service(self):
        result = self.execute(LOGIN, '''
chronyc() { return 0; }
sleep() { echo 'retry' >> "$EVENT_LOG"; exit 0; }
tailscale() {
    case "$1" in status) echo 'Logged out.' ;; esac
    return 1
}
update-rc.d() { echo unexpected-disable >> "$EVENT_LOG"; }
''', 'run')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events(), ['retry'])
        self.assertFalse(self.done.exists())

    def test_image_timestamp_overrides_2018_and_rejects_invalid_dates(self):
        body = re.search(r'^python x8_set_initial_timestamp\(\) \{\n(.*?)^\}',
                         RECIPE.read_text(), re.M | re.S).group(1)

        class BitBake:
            @staticmethod
            def fatal(message):
                raise ValueError(message)

        class Data(dict):
            def getVar(self, key):
                return self.get(key)

        namespace = {'bb': BitBake}
        exec('def configure(d):\n' + textwrap.indent(textwrap.dedent(body), '    '),
             namespace)
        data = Data(IMAGE_ROOTFS=str(self.root), X8_INITIAL_TIMESTAMP='20261006123000')
        self.timestamp.write_text('20180309123456\n')
        namespace['configure'](data)
        self.assertEqual(self.timestamp.read_text(), '20261006123000\n')
        for invalid in ('', '2026-10-06', '20260230120000', '20261006250000'):
            data['X8_INITIAL_TIMESTAMP'] = invalid
            with self.assertRaises(ValueError):
                namespace['configure'](data)
        self.assertEqual(self.timestamp.read_text(), '20261006123000\n')


if __name__ == '__main__':
    unittest.main()
