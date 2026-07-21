# syntax=docker/dockerfile:1.7

FROM node:22.23.1-bookworm-slim AS build

WORKDIR /app

ARG APP_FEATURE_PROFILE=lms-mvp

# Keeping dependency installation in its own layer makes production builds
# reproducible as long as package-lock.json is committed.
COPY package.json package-lock.json ./
RUN npm ci

# Copy only build inputs. This explicit allowlist prevents .env.production,
# service-account files, local caches, and operator artifacts from entering an
# image layer even when the repository has no root .dockerignore.
COPY nuxt.config.ts tsconfig.json app.vue error.vue ./
COPY assets ./assets
COPY components ./components
COPY composables ./composables
COPY config ./config
COPY data ./data
COPY layouts ./layouts
COPY middleware ./middleware
COPY pages ./pages
COPY plugins ./plugins
COPY public ./public
COPY server ./server
COPY shared ./shared
COPY types ./types
ENV NODE_ENV=production \
    APP_FEATURE_PROFILE=${APP_FEATURE_PROFILE}
RUN npm run build

FROM node:22.23.1-bookworm-slim AS runtime

ARG APP_VERSION=development
ARG APP_FEATURE_PROFILE=lms-mvp
ARG SOURCE_URL

ENV NODE_ENV=production \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000 \
    APP_VERSION=${APP_VERSION} \
    APP_FEATURE_PROFILE=${APP_FEATURE_PROFILE}

LABEL org.opencontainers.image.title="Nusa Campus" \
      org.opencontainers.image.version=${APP_VERSION} \
      org.opencontainers.image.source=${SOURCE_URL}

WORKDIR /app

COPY --from=build --chown=node:node /app/.output ./.output

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
