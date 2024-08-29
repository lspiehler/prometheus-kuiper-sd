FROM docker.io/node:lts-alpine
LABEL maintainer="Lyas Spiehler"

RUN apk add --no-cache --upgrade git

RUN mkdir -p /var/node

WORKDIR /var/node

ARG CACHE_DATE=2024-08-29

RUN git clone https://github.com/lspiehler/prometheus-kuiper-sd.git

WORKDIR /var/node/prometheus-kuiper-sd

RUN npm install

EXPOSE 3000/tcp

CMD ["npm", "start"]