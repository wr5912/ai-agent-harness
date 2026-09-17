# syntax=docker/dockerfile:1.7

# 源码由 build-image.sh 以固定提交生成，并通过 BuildKit named context 提供。
# Dockerfile 不从本仓库复制或隐式获取 DSH Runtime。
FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS build

ARG DSH_CLIENT_COMMIT_HASH=c291e7961a515f6d7af9304e7fd1d257929aef26
ARG DSH_LOCK_SHA256=66d87ed26fe3205172560351e13fe4aa736b66c15a29f7dd873c629fc80906de
ARG DSH_APT_MIRROR=http://deb.debian.org/debian

# 基础镜像使用 Debian 官方 HTTP 源与 debian-archive-keyring 签名验证；
# HTTPS 的 CA 引导问题不通过忽略 apt 索引错误规避。
COPY apt-mirror.sh /opt/dsh-adapter/apt-mirror.sh
RUN sh /opt/dsh-adapter/apt-mirror.sh "$DSH_APT_MIRROR" \
    && apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=30 -o Acquire::ForceIPv4=true \
      install -y --no-install-recommends ca-certificates build-essential musl-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/dsh
COPY --from=dsh_source / /opt/dsh

RUN test "$DSH_CLIENT_COMMIT_HASH" = c291e7961a515f6d7af9304e7fd1d257929aef26 \
    && test "$(sha256sum pnpm-lock.yaml | cut -d ' ' -f 1)" = "$DSH_LOCK_SHA256" \
    && test "$(node -p 'require("./package.json").version')" = 0.1.5-rc.2 \
    && corepack enable \
    && corepack prepare pnpm@11.7.0 --activate \
    && pnpm install --frozen-lockfile \
    && DSH_CLIENT_COMMIT_HASH="$DSH_CLIENT_COMMIT_HASH" pnpm run build \
    && test -s apps/cli/lib/bin.js \
    && rm -rf /opt/dsh/.git

FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553

COPY --from=build --chown=node:node /opt/dsh /opt/dsh
COPY --chown=node:node verify-load.mjs /opt/dsh-adapter/verify-load.mjs
COPY --chown=node:node tree-digest.mjs /opt/dsh-adapter/tree-digest.mjs
COPY --chown=node:node prepare-verification-home.mjs /opt/dsh-adapter/prepare-verification-home.mjs

RUN mkdir -p /var/lib/dsh/profiles/node_modules \
      /var/lib/dsh/profiles/web/node_modules \
      /var/lib/dsh/profiles/web/.dsh-module-fallback/node_modules \
      /var/lib/dsh/node_modules /work/harness/workspace \
    && chown -R node:node /var/lib/dsh /work/harness

ENV DSH_HOME=/var/lib/dsh
WORKDIR /work/harness/workspace
USER node
ENTRYPOINT ["node", "/opt/dsh/apps/cli/lib/bin.js"]
