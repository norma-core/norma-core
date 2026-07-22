ARG BASE_IMAGE=debian:trixie-slim
FROM ${BASE_IMAGE}

ARG DEBIAN_FRONTEND=noninteractive

# meson/ninja come from pip in a venv rather than apt: older bases (e.g.
# bullseye) ship a meson too old for libcamera's meson.build minimum
# version, and pinning via pip keeps the build tool versions identical
# across every base image we target.
RUN apt-get update -qq && apt-get install -y -qq \
    python3 \
    python3-venv \
    python3-pip \
    python3-yaml \
    python3-ply \
    python3-jinja2 \
    pkg-config \
    libgnutls28-dev \
    libyaml-dev \
    libdw-dev \
    libclang-dev \
    clang \
    libatomic1 \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv --system-site-packages /opt/venv && /opt/venv/bin/pip install --no-cache-dir meson==1.5.2 ninja==1.11.1.1
ENV PATH="/opt/venv/bin:${PATH}"

WORKDIR /src
