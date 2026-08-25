FROM node:22-alpine AS build
WORKDIR /app
ARG DD_APPLICATION_ID
ARG DD_CLIENT_TOKEN
ARG DD_SITE
ARG DD_SERVICE
ARG DD_ENV
ARG DD_VERSION
ARG DD_REQUIRE
ENV DD_APPLICATION_ID=$DD_APPLICATION_ID \
    DD_CLIENT_TOKEN=$DD_CLIENT_TOKEN \
    DD_SITE=$DD_SITE \
    DD_SERVICE=$DD_SERVICE \
    DD_ENV=$DD_ENV \
    DD_VERSION=$DD_VERSION \
    DD_REQUIRE=$DD_REQUIRE
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY server.mjs ./
EXPOSE 3000
CMD ["node", "server.mjs"]
