import pytest

from elrobot_ik.kinematics.ik import IKSolver
from elrobot_ik.kinematics.model import ElrobotModel


@pytest.fixture(scope="session")
def model():
    m = ElrobotModel()
    yield m
    m.close()


@pytest.fixture(scope="session")
def solver(model):
    return IKSolver(model)
