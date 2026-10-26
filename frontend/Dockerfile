FROM node:24.22.1-alpine

WORKDIR /app

# Install dependencies at build time (Linux-compatible binaries)
COPY package.json package-lock.json ./
# patch-package(postinstall)가 npm ci 중 적용할 로컬 패치. 이 COPY가 빠지면 빌드는
# 조용히 성공하지만 미패치 이미지가 나온다(patch-package는 패치 부재 시 exit 0 no-op).
COPY patches ./patches
RUN npm ci --legacy-peer-deps

EXPOSE 3000

CMD ["npm", "run", "dev"]
