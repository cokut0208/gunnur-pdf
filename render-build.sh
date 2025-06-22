#!/usr/bin/env bash
# exit on error
set -o errexit

npm install
npm install puppeteer --cache-dir /opt/render/.cache/puppeteer