# Free Render web service: MongoDB + busybox httpd health on $PORT.
FROM mongo:7

USER root
COPY --from=busybox:1.36.1-musl /bin/busybox /usr/local/bin/busybox
COPY start.sh /start.sh
RUN chmod +x /start.sh /usr/local/bin/busybox

ENV PORT=8080
EXPOSE 8080 27017
CMD ["/start.sh"]
