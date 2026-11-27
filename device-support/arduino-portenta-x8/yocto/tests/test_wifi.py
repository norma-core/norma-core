"""Host-side tests: python3 -m unittest discover -s tests -v (from yocto/)."""

import json
from pathlib import Path
import re
import stat
import tempfile
import textwrap
import unittest


LAYER = Path(__file__).resolve().parents[1] / 'meta-normacore-x8'
RECIPE = LAYER / 'recipes-core/images/x8-normacore.bb'
INTERFACES = (LAYER / 'recipes-core/init-ifupdown/files/interfaces').read_text()


class BuildError(Exception):
    pass


class BitBake:
    @staticmethod
    def fatal(message):
        raise BuildError(message)


class Data(dict):
    def getVar(self, key, expand=True):
        return self.get(key)


# Execute the actual postprocess body against a temporary rootfs.
body = re.search(r'^python x8_configure_wifi\(\) \{\n(.*?)^\}',
                 RECIPE.read_text(), re.M | re.S).group(1)
namespace = {'bb': BitBake}
exec('def configure(d):\n' + textwrap.indent(textwrap.dedent(body), '    '), namespace)
configure = namespace['configure']


class WifiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.interfaces = self.root / 'etc/network/interfaces'
        self.interfaces.parent.mkdir(parents=True)
        self.interfaces.write_text(INTERFACES)
        self.config = self.root / 'etc/wpa_supplicant/x8.conf'
        self.data = Data(IMAGE_ROOTFS=str(self.root), sysconfdir='/etc',
                         X8_WIFI_INTERFACE='wlan0', X8_WIFI_COUNTRY='ES')

    def provision(self, networks):
        self.data['X8_WIFI_NETWORKS'] = json.dumps(networks)
        configure(self.data)

    def test_disabled_leaves_networking_untouched(self):
        for raw in ('', '  ', '[]'):
            self.data['X8_WIFI_NETWORKS'] = raw
            configure(self.data)
            self.assertEqual(self.interfaces.read_text(), INTERFACES)
            self.assertFalse(self.config.exists())

    def test_multiple_networks_and_known_wpa_key(self):
        self.provision([
            {'ssid': 'IEEE', 'password': 'password', 'priority': 20},
            {'ssid': 'Phone', 'password': 'backup-password', 'hidden': True, 'priority': 10},
        ])
        config = self.config.read_text()
        self.assertEqual(config.count('network={'), 2)
        self.assertIn('ssid=49454545\n', config)
        self.assertIn('psk=f42c6fc52df0ebef9ebb4b90b38a5f902e83fe1b135a70e23aed762e9710a12e\n', config)
        self.assertIn('scan_ssid=0\n    priority=20\n', config)
        self.assertIn('scan_ssid=1\n    priority=10\n', config)
        self.assertIn('country=ES\n', config)
        self.assertNotIn('password', config)
        self.assertEqual(stat.S_IMODE(self.config.stat().st_mode), 0o600)
        interfaces = self.interfaces.read_text()
        self.assertTrue(interfaces.startswith(INTERFACES))
        self.assertEqual(interfaces.count('auto wlan0'), 1)
        self.assertIn('iface wlan0 inet dhcp\n', interfaces)
        self.assertIn('wpa-driver nl80211\n', interfaces)
        self.assertIn('wpa-conf /etc/wpa_supplicant/x8.conf\n', interfaces)

    def test_literal_credentials_and_utf8_ssid(self):
        ssid = 'café "${HOME}"\n}'
        self.provision([{'ssid': ssid, 'password': "'${HOME}`$(id)\\\""}])
        config = self.config.read_text()
        self.assertIn('ssid=' + ssid.encode().hex() + '\n', config)
        self.assertNotIn('${HOME}', config)
        self.assertEqual(config.count('network={'), 1)

    def test_raw_psk_and_optional_country(self):
        self.data['X8_WIFI_COUNTRY'] = ''
        self.data['X8_WIFI_INTERFACE'] = 'wlan1'
        self.provision([{'ssid': 'Test', 'password': 'AB' * 32}])
        self.assertIn('psk=' + 'ab' * 32 + '\n', self.config.read_text())
        self.assertNotIn('country=', self.config.read_text())
        self.assertIn('auto wlan1\n', self.interfaces.read_text())

    def test_invalid_networks_fail_before_writing_files(self):
        invalid = [None, {}, ['bad'], [{}], [{'ssid': 'test'}]]
        valid = {'ssid': 'Test', 'password': 'valid-password'}
        for field, values in {
            'ssid': ['', 'é' * 17, 'a' * 33, '\x00', '\ud800', 5],
            'password': ['', 'short', 'x' * 64, 'line\nbreak', 'nonascii-é', 5],
            'hidden': ['true', 1],
            'priority': [-1, 2147483648, '10', True],
            'typo': [True],
        }.items():
            invalid.extend([[valid, dict(valid, **{field: value})] for value in values])
        for networks in invalid:
            with self.subTest(networks=networks):
                with self.assertRaises(BuildError) as error:
                    self.provision(networks)
                self.assertNotIn('valid-password', str(error.exception))
                self.assertFalse(self.config.exists())
                self.assertEqual(self.interfaces.read_text(), INTERFACES)

    def test_malformed_json_does_not_echo_credentials(self):
        self.data['X8_WIFI_NETWORKS'] = '[{"password":"private-secret"'
        with self.assertRaises(BuildError) as error:
            configure(self.data)
        self.assertNotIn('private-secret', str(error.exception))

    def test_invalid_interface_and_country(self):
        for key, values in {'X8_WIFI_INTERFACE': ['lo', 'eth0', '../wlan0', 'wlan0\nauto bad', ''],
                            'X8_WIFI_COUNTRY': ['es', 'ESP', 'ES\nupdate_config=1']}.items():
            for value in values:
                with self.subTest(key=key, value=value):
                    original = self.data[key]
                    self.data[key] = value
                    with self.assertRaises(BuildError):
                        self.provision([{'ssid': 'Test', 'password': 'password'}])
                    self.data[key] = original
                    self.assertFalse(self.config.exists())


if __name__ == '__main__':
    unittest.main()
