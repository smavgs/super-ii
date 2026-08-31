FROM rust:1.97.0-bookworm@sha256:8fa55b2f3ddf97471ab6a767bfa3f37e6bad0986ba823e75fea57e2a2a5c3073 AS builder

WORKDIR /source
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --locked --release --bin superii-transferd

FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

RUN addgroup --system --gid 10001 superii \
    && adduser --system --uid 10001 --gid 10001 --home /nonexistent --no-create-home superii
COPY --from=builder /source/target/release/superii-transferd /usr/local/bin/superii-transferd

USER 10001:10001
ENTRYPOINT ["/usr/local/bin/superii-transferd"]
