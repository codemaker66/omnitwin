FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @omnitwin/api build
EXPOSE 3000
CMD ["pnpm", "--filter", "@omnitwin/api", "start"]
