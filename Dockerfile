# calendar plugin image (Jarvis plugin spec 0.2). Needs only this folder, not the Jarvis source.
# On the nas the Jarvis install script builds it and gives it PLUGIN_KEY; /data is this plugin's data folder.
FROM node:24-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/data
WORKDIR /plugin
COPY . .
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "plugin.js"]
