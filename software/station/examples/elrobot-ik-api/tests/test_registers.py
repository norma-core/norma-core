from elrobot_ik.station import registers as R
from tests.helpers import make_snapshot


def test_present_position_plain():
    assert R.present_position(make_snapshot(2048)) == 2048


def test_present_position_sign_bit_is_normalized():
    # 0x8000 | 100 means "-100" on the servo; normalized into 0..4095 it wraps to 3996.
    assert R.normalize_position(0x8000 | 100) == 3996
    assert R.present_position(make_snapshot(0x8000 | 100)) == 3996


def test_voltage_and_torque():
    snap = make_snapshot(10, voltage_v=12.3, torque=False)
    assert abs(R.voltage_v(snap) - 12.3) < 1e-9
    assert R.torque_enabled(snap) is False


def test_status_zero_is_no_error():
    assert R.has_error(make_snapshot(10, status=0)) is False
    assert R.has_error(make_snapshot(10, status=0x20)) is True


def test_short_snapshot_is_error():
    # A motor that has just connected can publish a truncated snapshot.
    short = make_snapshot(10)[:0x30]
    assert R.has_error(short) is True
    assert R.present_position(short) == 0
    assert R.voltage_v(short) == 0.0
