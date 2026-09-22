# syntax=docker/dockerfile:1.7

# 源码由 build-image.sh 以固定提交生成，并通过 BuildKit named context 提供。
# Dockerfile 不从本仓库复制或隐式获取 DSH Runtime。
ARG DSH_NODE_BASE
FROM ${DSH_NODE_BASE} AS build

ARG DSH_CLIENT_COMMIT_HASH
ARG DSH_LOCK_SHA256
ARG DSH_CLI_VERSION
ARG DSH_PACKAGE_MANAGER
# 构建期统一使用国内阿里云源：APT 用 mirrors.aliyun.com，npm/pnpm 用 registry.npmmirror.com。
# 两者仍由 debian-archive-keyring 与包完整性摘要校验；国内源不可达时才由调用方显式改回官方源。
ARG DSH_APT_MIRROR=http://mirrors.aliyun.com/debian
ARG DSH_NPM_REGISTRY=https://registry.npmmirror.com
ENV COREPACK_HOME=/opt/corepack

# 基础镜像使用 Debian HTTP 源与 debian-archive-keyring 签名验证；
# HTTPS 的 CA 引导问题不通过忽略 apt 索引错误规避。
COPY apt-mirror.sh /opt/dsh-adapter/apt-mirror.sh
RUN sh /opt/dsh-adapter/apt-mirror.sh "$DSH_APT_MIRROR" \
    && apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=30 -o Acquire::ForceIPv4=true \
      install -y --no-install-recommends ca-certificates build-essential musl-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/dsh
COPY --from=dsh_source / /opt/dsh

# corepack 下载包管理器、pnpm 解析依赖都走同一个国内 registry；
# 依赖仍按 pnpm-lock.yaml 的完整性摘要校验，换源不改变锁定内容。
RUN test -n "$DSH_CLIENT_COMMIT_HASH" \
    && test -n "$DSH_LOCK_SHA256" \
    && test -n "$DSH_CLI_VERSION" \
    && test -n "$DSH_PACKAGE_MANAGER" \
    && test -n "$DSH_NPM_REGISTRY" \
    && test "$(sha256sum pnpm-lock.yaml | cut -d ' ' -f 1)" = "$DSH_LOCK_SHA256" \
    && test "$(node -p 'require("./package.json").version')" = "$DSH_CLI_VERSION" \
    && corepack enable \
    && COREPACK_NPM_REGISTRY="$DSH_NPM_REGISTRY" corepack prepare "$DSH_PACKAGE_MANAGER" --activate \
    && npm_config_registry="$DSH_NPM_REGISTRY" pnpm install --frozen-lockfile \
    && DSH_CLIENT_COMMIT_HASH="$DSH_CLIENT_COMMIT_HASH" pnpm run build \
    && test -s apps/cli/lib/bin.js \
    && rm -rf /opt/dsh/.git

ARG DSH_NODE_BASE
FROM ${DSH_NODE_BASE}

ENV COREPACK_HOME=/opt/corepack
COPY --from=build --chown=node:node /opt/corepack /opt/corepack
COPY --from=build --chown=node:node /opt/dsh /opt/dsh
COPY --chmod=0755 dsh-cli.sh /usr/local/bin/dsh

# 评测执行器复用 DSH 已安装的 Playwright，只补充无头浏览器二进制。
ARG DSH_APT_MIRROR=http://mirrors.aliyun.com/debian
COPY apt-mirror.sh /opt/dsh-adapter/apt-mirror.sh
RUN sh /opt/dsh-adapter/apt-mirror.sh "$DSH_APT_MIRROR" \
    && apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=30 -o Acquire::ForceIPv4=true \
      install -y --no-install-recommends chromium \
    && rm -rf /var/lib/apt/lists/* /opt/dsh-adapter

# 运行期适配层脚本不 COPY 进镜像：它们由 Compose 以只读 bind 挂载到 /opt/dsh-adapter。
# 这样脚本改动只需重新启动实例，不必重建镜像，也不会出现"镜像内脚本过期"的中间状态。
RUN mkdir -p /opt/dsh-adapter \
      /var/lib/dsh/profiles/node_modules \
      /var/lib/dsh/profiles/web/node_modules \
      /var/lib/dsh/profiles/web/.dsh-module-fallback/node_modules \
      /var/lib/dsh/node_modules /work/harness/workspace \
    && chown -R node:node /var/lib/dsh /work/harness \
    && corepack enable

ENV DSH_HOME=/var/lib/dsh
WORKDIR /work/harness/workspace
USER node
ENTRYPOINT ["node", "/opt/dsh/apps/cli/lib/bin.js"]
