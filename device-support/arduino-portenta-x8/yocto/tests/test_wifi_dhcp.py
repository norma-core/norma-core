"""Exercise the shipped shell hooks without touching host networking/processes."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


FILES = (Path(__file__).resolve().parents[1] / 'meta-normacore-x8' /
         'recipes-core/init-ifupdown/files')


class WifiDhcpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.run = self.root / 'run'
        self.proc = self.root / 'proc/123'
        self.run.mkdir()
        self.proc.mkdir(parents=True)
        self.pidfile = self.run / 'udhcpc.wlan0.pid'
        self.pidfile.write_text('123\n')
        (self.proc / 'comm').write_text('udhcpc\n')
        (self.proc / 'cmdline').write_bytes(b'udhcpc\0-R\0-b\0-p\0/var/run/udhcpc.wlan0.pid\0-i\0wlan0\0')
        self.log = self.root / 'events'
        self.env = dict(os.environ, EVENT_LOG=str(self.log))
        self.scripts = {}
        for name in ('x8-wifi-dhcp', 'x8-wifi-dhcp-action'):
            content = (FILES / name).read_text()
            content = content.replace('/var/run/', str(self.run) + '/')
            content = content.replace('/proc/', str(self.root / 'proc') + '/')
            path = self.root / name
            path.write_text(content)
            self.scripts[name] = path
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        mock = self.bin / 'start-stop-daemon'
        mock.write_text('#!/bin/sh\nprintf "daemon %s\\n" "$*" >> "$EVENT_LOG"\n')
        mock.chmod(0o755)
        self.env['PATH'] = str(self.bin) + ':' + self.env['PATH']

    def execute(self, name, *args):
        # Functions shadow shell builtins/commands; no real signals or IP changes.
        wrapper = '''
kill() { printf 'kill %s\\n' "$*" >> "$EVENT_LOG"; }
sleep() { printf 'sleep %s\\n' "$*" >> "$EVENT_LOG"; }
ip() { printf 'ip %s\\n' "$*" >> "$EVENT_LOG"; }
logger() { :; }
script=$1
shift
. "$script"
'''
        return subprocess.run(['sh', '-c', wrapper, 'test', str(self.scripts[name]), *args],
                              env=self.env, capture_output=True, text=True)

    def events(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def test_reconnection_discards_old_lease_before_discovery(self):
        result = self.execute('x8-wifi-dhcp-action', 'wlan0', 'CONNECTED')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events(), ['kill -USR2 123', 'sleep 1',
                                        'ip -4 route flush dev wlan0', 'kill -USR1 123'])

    def test_disconnect_releases_without_starting_discovery(self):
        result = self.execute('x8-wifi-dhcp-action', 'wlan0', 'DISCONNECTED')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events(), ['kill -USR2 123', 'sleep 1',
                                        'ip -4 route flush dev wlan0'])

    def test_stale_pid_for_other_process_is_not_signalled(self):
        (self.proc / 'comm').write_text('station\n')
        self.assertEqual(self.execute('x8-wifi-dhcp-action', 'wlan0', 'CONNECTED').returncode, 0)
        self.assertEqual(self.events(), [])

    def test_other_interfaces_dhcp_is_not_signalled(self):
        (self.proc / 'cmdline').write_bytes(b'udhcpc\0-i\0eth0\0')
        self.assertEqual(self.execute('x8-wifi-dhcp-action', 'wlan0', 'CONNECTED').returncode, 0)
        self.assertEqual(self.events(), [])

    def test_missing_client_and_unrelated_events_are_ignored(self):
        self.pidfile.unlink()
        for event in ('CONNECTED', 'DISCONNECTED', 'SCAN-RESULTS'):
            self.assertEqual(self.execute('x8-wifi-dhcp-action', 'wlan0', event).returncode, 0)
        self.assertEqual(self.events(), [])

    def test_invalid_pids_are_never_signalled(self):
        for pid in ('0', '1', '-1', 'garbage'):
            self.pidfile.write_text(pid + '\n')
            self.assertNotEqual(self.execute('x8-wifi-dhcp-action', 'wlan0', 'CONNECTED').returncode, 0)
        self.assertEqual(self.events(), [])

    def test_monitor_follows_ifupdown_lifecycle(self):
        config = self.root / 'wifi.conf'
        config.write_text('ctrl_interface=/var/run/wpa_supplicant\n')
        self.env.update(IFACE='wlan0', IF_WPA_CONF=str(config), MODE='start')
        result = self.execute('x8-wifi-dhcp')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('--start --quiet --oknodo --pidfile', self.events()[0])
        self.assertIn('-i wlan0 -a /usr/sbin/x8-wifi-dhcp-action', self.events()[0])
        monitor = self.run / 'x8-wifi-dhcp.wlan0.pid'
        monitor.write_text('456\n')
        self.env['MODE'] = 'stop'
        result = self.execute('x8-wifi-dhcp')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('--stop --quiet --oknodo --pidfile', self.events()[1])
        self.assertFalse(monitor.exists())

    def test_non_wifi_interface_does_not_start_monitor(self):
        self.env.update(IFACE='eth0', MODE='start')
        self.env.pop('IF_WPA_CONF', None)
        self.assertEqual(self.execute('x8-wifi-dhcp').returncode, 0)
        self.assertEqual(self.events(), [])


if __name__ == '__main__':
    unittest.main()
