FROM debian:trixie-slim

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update -qq && apt-get install -y -qq \
    meson \
    ninja-build \
    pkg-config \
    python3-yaml \
    python3-ply \
    python3-jinja2 \
    libgnutls28-dev \
    libyaml-dev \
    libdw-dev \
    libclang-dev \
    clang \
    libatomic1 \
    ca-certificates \
    git-all \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
