"""The station's motors-mirroring state: which buses a leader is currently driven onto.

The mirroring driver publishes a `mirroring.RxEnvelope` to `inference/mirroring` at startup and
after every start/stop command, so the newest entry is the current state.
"""
from elrobot_ik.station.proto import mirroring_pb2

MIRRORING_QUEUE = "inference/mirroring"


def mirroring_targets(entry: bytes) -> frozenset[str]:
    """Serials of the buses that are mirroring targets (followers driven by a leader) in an entry."""
    env = mirroring_pb2.RxEnvelope.FromString(entry)
    return frozenset(t.id.unique_id for m in env.state.mirroring for t in m.targets)
