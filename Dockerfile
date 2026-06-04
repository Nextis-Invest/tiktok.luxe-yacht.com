# First, specify the base Docker image. You can read more about
# the available images at https://sdk.apify.com/docs/guides/docker-images
# You can also use any other image from Docker Hub.
FROM oven/bun:1.3.10 AS bun

FROM apify/actor-node-puppeteer-chrome:16

USER root

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

# Second, copy just package.json and bun.lock since they should be
# the only files that affect dependency installation in the next step.
COPY package.json bun.lock ./

# Install packages, skip development dependencies to
# keep the image small. Avoid logging too much and print the dependency
# tree for debugging
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential python3 \
 && rm -rf /var/lib/apt/lists/* \
 && bun install --production --frozen-lockfile \
 && echo "Installed Bun packages:" \
 && (bun pm ls || true) \
 && echo "Node.js version:" \
 && node --version \
 && echo "Bun version:" \
 && bun --version \
 && chown -R myuser:myuser /home/myuser

# Next, copy the remaining files and directories with the source code.
# Since we do this after NPM install, quick build will be really fast
# for most source file changes.
COPY --chown=myuser:myuser . ./

USER myuser

EXPOSE 3000

CMD ["bun", "run", "start"]
