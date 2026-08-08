FROM alpine:3.20 AS overlay

ARG UV_VERSION=0.9.18
ARG UV_TARGET=aarch64-unknown-linux-gnu
ARG UV_SHA256=f8e23ec786b18660ade6b033b6191b7e9c283c872eeb8c4531d56a873decf160
ARG TAILSCALE_VERSION=1.98.3
ARG TAILSCALE_ARCH=arm64
ARG TAILSCALE_SHA256=d26ce4a1a259621fc76d16c7baf3f3a4252f356dfa9d9769484782f766ca1b7f

RUN apk add --no-cache ca-certificates curl tar

WORKDIR /out

RUN set -eu; \
    install -d -m 0755 /out/root/usr/local/bin; \
    uv_dir="/tmp/uv-${UV_TARGET}"; \
    curl -fsSL "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${UV_TARGET}.tar.gz" -o /tmp/uv.tar.gz; \
    printf '%s  %s\n' "$UV_SHA256" /tmp/uv.tar.gz | sha256sum -c -; \
    tar -xzf /tmp/uv.tar.gz -C /tmp; \
    install -m 0755 "$uv_dir/uv" /out/root/usr/local/bin/uv; \
    install -m 0755 "$uv_dir/uvx" /out/root/usr/local/bin/uvx; \
    rm -rf /tmp/uv.tar.gz "$uv_dir"; \
    chmod 0755 /out/root/usr/local/bin/uv /out/root/usr/local/bin/uvx

RUN set -eu; \
    tailscale_dir="/tmp/tailscale_${TAILSCALE_VERSION}_${TAILSCALE_ARCH}"; \
    curl -fsSL "https://pkgs.tailscale.com/stable/tailscale_${TAILSCALE_VERSION}_${TAILSCALE_ARCH}.tgz" -o /tmp/tailscale.tgz; \
    printf '%s  %s\n' "$TAILSCALE_SHA256" /tmp/tailscale.tgz | sha256sum -c -; \
    tar -xzf /tmp/tailscale.tgz -C /tmp; \
    install -D -m 0755 "$tailscale_dir/tailscale" /out/root/usr/bin/tailscale; \
    install -D -m 0755 "$tailscale_dir/tailscaled" /out/root/usr/sbin/tailscaled; \
    install -D -m 0644 "$tailscale_dir/systemd/tailscaled.service" /out/root/usr/lib/systemd/system/tailscaled.service; \
    rm -rf /tmp/tailscale.tgz "$tailscale_dir"

COPY rootfs/ /out/root/

RUN set -eu; \
    mkdir -p \
      /out/boot; \
    if [ -d /out/root/boot/firmware ]; then \
      cp -a /out/root/boot/firmware/. /out/boot/; \
      rm -rf /out/root/boot; \
    fi; \
    chmod 0755 /out/root/opt/station/station; \
    chmod 0755 /out/root/usr/local/bin/firstboot.sh; \
    chmod 0755 /out/root/usr/local/bin/uv

FROM scratch

COPY --from=overlay /out /
