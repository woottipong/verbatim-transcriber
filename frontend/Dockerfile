FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .

ARG VITE_BACKEND_URL=http://localhost:3000
ARG VITE_LIVEKIT_URL=ws://localhost:7880

ARG VITE_CONTROL_API_KEY=

ENV VITE_BACKEND_URL=$VITE_BACKEND_URL \
    VITE_LIVEKIT_URL=$VITE_LIVEKIT_URL \
    VITE_CONTROL_API_KEY=$VITE_CONTROL_API_KEY

RUN pnpm build


FROM nginx:1.27-alpine AS runtime

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/captionlive.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
