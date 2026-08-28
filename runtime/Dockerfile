FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171 AS llama-bin

ARG LLAMA_CPP_VERSION=b10516
ARG TARGETARCH
ARG LLAMA_SHA256_AMD64=f263a91280471b4c33c4999d7c76259c0f3a0a53a0b3e692b2c0b84380137a35
ARG LLAMA_SHA256_ARM64=e7491dca79c9799fc3ae169675a79f5777d3027e31ffb08ae679e5e0a7ae3c97

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64) archive_arch=x64; expected="${LLAMA_SHA256_AMD64}" ;; \
      arm64) archive_arch=arm64; expected="${LLAMA_SHA256_ARM64}" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    archive="llama-${LLAMA_CPP_VERSION}-bin-ubuntu-${archive_arch}.tar.gz"; \
    curl --fail --location --silent --show-error \
      --connect-timeout 20 --max-time 300 --retry 3 \
      "https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_VERSION}/${archive}" \
      --output "/tmp/${archive}"; \
    echo "${expected}  /tmp/${archive}" | sha256sum --check --strict; \
    mkdir --parents /opt/llama; \
    tar --extract --gzip --strip-components=1 --file "/tmp/${archive}" --directory /opt/llama; \
    test -x /opt/llama/llama-cli; \
    test -x /opt/llama/llama-server

FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171 AS gitleaks-builder

ARG GITLEAKS_VERSION=8.30.1
ARG TARGETARCH
ARG GITLEAKS_SHA256_AMD64=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
ARG GITLEAKS_SHA256_ARM64=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64) archive_arch=x64; expected="${GITLEAKS_SHA256_AMD64}" ;; \
      arm64) archive_arch=arm64; expected="${GITLEAKS_SHA256_ARM64}" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    archive="gitleaks_${GITLEAKS_VERSION}_linux_${archive_arch}.tar.gz"; \
    curl --fail --location --silent --show-error \
      "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${archive}" \
      --output "/tmp/${archive}"; \
    echo "${expected}  /tmp/${archive}" | sha256sum --check --strict; \
    tar --extract --gzip --file "/tmp/${archive}" --directory /usr/local/bin gitleaks

FROM ghcr.io/astral-sh/uv:0.11.24@sha256:99ea34acedc870ba4ad11a1f540a1c04267c9f30aadc465a94406f52dfda2c36 AS uv-bin

FROM python:3.12.13-slim-trixie@sha256:229a2c5bfa27522db7815ea81f9bed70af17ccb9de9fc7ad142b1877b5830d36

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HUB_OFFLINE=1 \
    HF_DATASETS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TRANSFORMERS_OFFLINE=1

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates clamdscan libgomp1 tini \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system --gid 10001 superii \
    && adduser --system --uid 10001 --gid 10001 --home /nonexistent --no-create-home superii

COPY --from=llama-bin /opt/llama /opt/llama
COPY --from=gitleaks-builder /usr/local/bin/gitleaks /usr/local/bin/gitleaks
COPY --from=uv-bin /uv /usr/local/bin/uv

WORKDIR /opt/superii-runtime
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
RUN uv sync --frozen --no-dev --no-editable \
    && rm -rf /root/.cache/uv

ENV PATH="/opt/superii-runtime/.venv/bin:/opt/llama:${PATH}" \
    LD_LIBRARY_PATH="/opt/llama" \
    SUPERII_STORAGE_ROOT="/data"

RUN mkdir --parents /data \
    && chown 10001:10001 /data \
    && chmod 750 /data

USER 10001:10001
EXPOSE 8788

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["superii-runtime"]
