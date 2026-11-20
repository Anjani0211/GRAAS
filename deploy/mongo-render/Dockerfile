# Free Render web service: MongoDB + tiny HTTP health on $PORT.
# Mongo listens on 27017 for private-network peers (not published as public HTTP).
FROM mongo:7

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/*

COPY start.sh /start.sh
RUN chmod +x /start.sh

ENV PORT=8080
EXPOSE 8080 27017
CMD ["/start.sh"]
