# Isolated development image: all dependency installs, builds, and repo scripts
# run here rather than on the host.
FROM oven/bun:1.4.3-debian

# Pre-create the node_modules mount point owned by the unprivileged `bun` user
# so the named volume inherits that ownership on first mount (the container runs
# with all capabilities dropped and cannot chown at runtime).
RUN mkdir -p /workspaces/homelab-launchpad/node_modules \
    && chown -R bun:bun /workspaces

USER bun
