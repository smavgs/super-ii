FROM python:3.12.13-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2

COPY --from=ghcr.io/astral-sh/uv:0.11.24@sha256:99ea34acedc870ba4ad11a1f540a1c04267c9f30aadc465a94406f52dfda2c36 /uv /usr/local/bin/uv

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    HF_HOME=/tmp/huggingface \
    GRADIO_TEMP_DIR=/tmp/gradio

WORKDIR /runner
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-editable \
    && rm -rf /root/.cache/uv \
    && addgroup --system --gid 65532 superii \
    && adduser --system --uid 65532 --gid 65532 --no-create-home superii

COPY --chown=65532:65532 launch_gradio.py space_proxy.py /runner/

ENV PATH="/runner/.venv/bin:${PATH}"

USER 65532:65532
WORKDIR /workspace
EXPOSE 7860

ENTRYPOINT ["python", "/runner/launch_gradio.py"]
