#!/usr/bin/env bash
# exit on error
set -o errexit

# Önce normal paketleri kur
npm install

# SONRA, PUPPETEER'A AÇIKÇA CHROME'U İNDİRMESİNİ SÖYLE
# Bu komut, Render'ın önbellek ayarını kullanarak tarayıcıyı doğru yere kurar.
npx puppeteer browsers install chrome