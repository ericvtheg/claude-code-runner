# Internal Docker Release Process

This document describes the internal Docker release process, which allows for internal testing of Docker images before promoting them to the public `latest` tag.

## Overview

The release process works as follows:

1. **On push to main**: Build and push internal Docker images
   - Tagged with git SHA (e.g., `abc1234`) for specific version tracking
   - Tagged with `main` for always-latest internal builds

2. **On semantic release**: Push versioned release images
   - Tagged with version number (e.g., `1.2.3`)
   - NOT tagged as `latest` (manual promotion required)

3. **Manual promotion**: Promote any image tag to `latest`
   - Triggered via GitHub Actions UI
   - Allows testing before public release

## Workflow Changes Required

To enable this process, update `.github/workflows/release.yml` with the following content:

```yaml
name: Release

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      action:
        description: 'Action to perform'
        required: true
        default: 'promote-to-latest'
        type: choice
        options:
          - promote-to-latest
      image_tag:
        description: 'Image tag to promote to latest (e.g., abc1234 or main)'
        required: false
        default: 'main'
        type: string

env:
  IMAGE_NAME: ${{ secrets.DOCKERHUB_USERNAME }}/claude-code-runner

jobs:
  # Semantic release job - only runs on push to main
  release:
    if: github.event_name == 'push'
    runs-on: self-hosted
    permissions:
      contents: write
      issues: write
      pull-requests: write
    outputs:
      new_release_version: ${{ steps.semantic.outputs.new_release_version }}
      new_release_published: ${{ steps.semantic.outputs.new_release_published }}
      git_sha_short: ${{ steps.vars.outputs.git_sha_short }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false

      - name: Set variables
        id: vars
        run: echo "git_sha_short=$(git rev-parse --short HEAD)" >> $GITHUB_OUTPUT

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install semantic-release
        run: npm install -g semantic-release @semantic-release/github @semantic-release/exec

      - name: Release
        id: semantic
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          npx semantic-release 2>&1 | tee release-output.txt
          if grep -q "Published release" release-output.txt; then
            VERSION=$(grep -oP 'Published release \K[0-9]+\.[0-9]+\.[0-9]+' release-output.txt)
            echo "new_release_published=true" >> $GITHUB_OUTPUT
            echo "new_release_version=$VERSION" >> $GITHUB_OUTPUT
          else
            echo "new_release_published=false" >> $GITHUB_OUTPUT
          fi

  # Always build and push internal release images on push to main
  docker-internal:
    needs: release
    if: github.event_name == 'push'
    runs-on: self-hosted
    permissions:
      contents: read

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Build and push internal release
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            ${{ env.IMAGE_NAME }}:${{ needs.release.outputs.git_sha_short }}
            ${{ env.IMAGE_NAME }}:main
          cache-from: type=local,src=/tmp/.buildx-cache
          cache-to: type=local,dest=/tmp/.buildx-cache-new,mode=max

      - name: Move cache
        run: |
          rm -rf /tmp/.buildx-cache
          mv /tmp/.buildx-cache-new /tmp/.buildx-cache

  # Build and push versioned release when semantic-release creates a new version
  docker-versioned:
    needs: release
    if: github.event_name == 'push' && needs.release.outputs.new_release_published == 'true'
    runs-on: self-hosted
    permissions:
      contents: read

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Build and push versioned release
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            ${{ env.IMAGE_NAME }}:${{ needs.release.outputs.new_release_version }}
          cache-from: type=local,src=/tmp/.buildx-cache
          cache-to: type=local,dest=/tmp/.buildx-cache-new,mode=max

      - name: Move cache
        run: |
          rm -rf /tmp/.buildx-cache
          mv /tmp/.buildx-cache-new /tmp/.buildx-cache

  # Manual promotion of an image tag to 'latest'
  promote-to-latest:
    if: github.event_name == 'workflow_dispatch' && inputs.action == 'promote-to-latest'
    runs-on: self-hosted
    permissions:
      contents: read

    steps:
      - name: Log in to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Pull source image
        run: docker pull ${{ env.IMAGE_NAME }}:${{ inputs.image_tag }}

      - name: Tag as latest
        run: docker tag ${{ env.IMAGE_NAME }}:${{ inputs.image_tag }} ${{ env.IMAGE_NAME }}:latest

      - name: Push latest tag
        run: docker push ${{ env.IMAGE_NAME }}:latest

      - name: Summary
        run: |
          echo "## Promotion Complete" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "Promoted \`${{ env.IMAGE_NAME }}:${{ inputs.image_tag }}\` to \`${{ env.IMAGE_NAME }}:latest\`" >> $GITHUB_STEP_SUMMARY
```

## How to Promote an Image to Latest

1. Go to **Actions** > **Release** workflow
2. Click **Run workflow**
3. Select `promote-to-latest` action
4. Enter the image tag to promote (e.g., `abc1234` for a specific commit, or `main` for the latest internal build)
5. Click **Run workflow**

The workflow will:
1. Pull the specified image from Docker Hub
2. Tag it as `latest`
3. Push the `latest` tag to Docker Hub

## Image Tags

| Tag | Description | When Updated |
|-----|-------------|--------------|
| `main` | Latest build from main branch | Every push to main |
| `<sha>` | Build from specific commit | Every push to main |
| `<version>` | Semantic version (e.g., 1.2.3) | When semantic-release publishes |
| `latest` | Production release | Manual promotion only |
