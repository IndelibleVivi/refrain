FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3

ENV NODE_ENV=production \
    __PORT=3000 \
    REFRAIN_RELEASE_FILE=/app/release.json

LABEL org.opencontainers.image.title="Refrain MCP runtime" \
      org.opencontainers.image.revision="@@REFRAIN_SOURCE_REVISION@@" \
      io.refrain.bundle.digest="@@REFRAIN_BUNDLE_DIGEST@@"

WORKDIR /app

COPY package.json package-lock.json ./
COPY LICENSE LICENSE-CONTENT LICENSING.md ./
COPY third_party ./third_party
COPY docs ./docs
COPY release.json ./release.json
COPY apps ./apps
COPY packages ./packages
COPY scripts/start-mcp.mjs ./scripts/start-mcp.mjs
COPY deploy ./deploy

RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(async r=>{const v=await r.json();process.exit(r.status===200&&v.status==='ok'&&v.server==='Refrain'&&/^sha256:[0-9a-f]{64}$/.test(v.release?.bundleDigest)?0:1)}).catch(()=>process.exit(1))"]

CMD ["node", "--conditions=refrain-built", "scripts/start-mcp.mjs", "--port", "3000"]
