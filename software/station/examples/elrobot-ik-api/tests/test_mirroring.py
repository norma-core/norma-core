from elrobot_ik.station.mirroring import MIRRORING_QUEUE, mirroring_targets
from tests.helpers import make_mirroring_state


def test_reads_the_stations_mirroring_queue():
    assert MIRRORING_QUEUE == "inference/mirroring"


def test_no_targets_when_nothing_is_mirrored():
    assert mirroring_targets(make_mirroring_state()) == frozenset()


def test_targets_exclude_the_source():
    assert mirroring_targets(make_mirroring_state(["F1", "F2"], source="L1")) == {"F1", "F2"}
