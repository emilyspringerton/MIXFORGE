FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux && chmod +x /usr/local/bin/yt-dlp \
 && mkdir -p /root/.deno/bin && curl -fsSL -o /tmp/deno.zip https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip \
 && unzip -o /tmp/deno.zip -d /root/.deno/bin && rm /tmp/deno.zip
WORKDIR /app
COPY server/ /app/server/
COPY web/ /app/web/
RUN cd /app/server && npm ci --omit=dev && rm -rf /app/web/room-cache && ln -s /run/mixforge/cache /app/web/room-cache
# room_server downloads into web/room-cache (symlink -> shared emptyDir that the nginx container serves at /room-cache/).
RUN printf '#!/bin/sh\nmkdir -p /run/mixforge/cache && chmod 777 /run/mixforge/cache\nexport PORT=8973 HOST=0.0.0.0 MIXFORGE_YTDLP_BIN=/usr/local/bin/yt-dlp\nexec node /app/server/room_server.mjs\n' > /run-room.sh && chmod +x /run-room.sh
