FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    coreutils \
    curl \
    dosfstools \
    e2fsprogs \
    fdisk \
    mtools \
    parted \
    rsync \
    tar \
    util-linux \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

COPY pack.sh /usr/local/bin/pack

RUN chmod +x /usr/local/bin/pack

ENTRYPOINT ["/usr/local/bin/pack"]
