FROM node:14.17.0-alpine

RUN apk update &&  \
    apk upgrade && \
    apk -Uuv add --no-cache make g++ git python py-pip jq openssh curl openssh docker python3 &&  \
    pip3 install -U pip

RUN python3 -m pip install --no-cache-dir --upgrade awscli

#RUN mkdir ~/.ssh/known_hosts
#RUN ssh-keyscan -t rsa github.com >> ~/.ssh/known_hosts
RUN ssh-keyscan github.com >> /root/.ssh/known_hosts


RUN adduser -S dolomite
RUN mkdir -p /home/dolomite/app
RUN chown dolomite -R /home/dolomite/app
USER dolomite

WORKDIR /home/dolomite/app

COPY ./.env* ./
COPY ./package.json ./package-lock.json ./
RUN npm ci --loglevel warn

COPY ./src ./src
COPY ./__tests__ ./__tests__
COPY ./tsconfig.json ./tsconfig.json
COPY ./environment.d.ts ./environment.d.ts

RUN npm run build

CMD ["npm", "start"]
