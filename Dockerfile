FROM trevoreyre/node
ENV HOST 0.0.0.0
USER node

RUN mkdir /home/node/notion
RUN mkdir /home/node/notion/node_modules

WORKDIR /home/node/notion
