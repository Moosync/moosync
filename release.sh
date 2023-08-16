VERSION=$(cat package.json |
  grep version |
  head -1 |
  awk -F: '{ print $2 }' |
  sed 's/[",]//g')

VERSION=$(echo $VERSION | xargs)

## bump AUR
cd aur/moosync
git checkout master
sed -i "s/pkgver=.*/pkgver=${VERSION}/" PKGBUILD
sed -i "s/pkgrel=.*/pkgrel=1/" PKGBUILD
updpkgsums
makepkg --printsrcinfo >.SRCINFO
git add -A
git commit -m "Bump to $VERSION"
git push origin
cd ../../

cd aur/moosync-bin
git checkout master
sed -i "s/pkgver=.*/pkgver=${VERSION}/" PKGBUILD
sed -i "s/pkgrel=.*/pkgrel=1/" PKGBUILD
updpkgsums
makepkg --printsrcinfo >.SRCINFO
git add -A
git commit -m "Bump to $VERSION"
git push origin
cd ../../

## bump flatpak
cd flatpak
git checkout master
git pull origin master
python flatpak-node-generator.py yarn --electron-node-headers ../yarn.lock
sed -i "s/tag: v.*/tag: v${VERSION}/" app.moosync.moosync.yml

FLATPAK_PARTIAL_DOWNLOAD="https://github.com/Moosync/Moosync/releases/download/v"
FLATPAK_DOWNLOAD="https://github.com/Moosync/Moosync/releases/download/v$VERSION/Moosync-$VERSION-linux-x64.pacman"
sed -i "s@${FLATPAK_PARTIAL_DOWNLOAD}.*@${FLATPAK_DOWNLOAD}@" app.moosync.moosync.yml
wget ${FLATPAK_DOWNLOAD} -O flatpak_download_tmp
CHECKSUM_FLATPAK=$(sha256sum flatpak_download_tmp | cut -d' ' -f1)
rm -f flatpak_download_tmp
echo $CHECKSUM_FLATPAK
./venv/bin/python flatpak-node-generator.py yarn --electron-node-headers ../yarn.lock
./venv/bin/python flatpak-cargo-generator.py ../node_modules/librespot-node/native/Cargo.lock -o generated-sources-cargo.json
./venv/bin/python flatpak-cargo-generator.py ../node_modules/scanner-native/Cargo.lock -o generated-sources-cargo-scanner.json

sed -i "\@${FLATPAK_PARTIAL_DOWNLOAD}.*@{n;s@.*@        sha256: ${CHECKSUM_FLATPAK}@}" app.moosync.moosync.yml
git add -A
git commit -m "Bump to $VERSION"
git checkout -b "$VERSION"
git push origin "$VERSION"
git checkout master
cd ../

## bump chocolatey
cd chocolatey
sed -i "s@<version>.*@<version>${VERSION}</version>@" moosync.nuspec
sed -i "s@<releaseNotes>.*@<releaseNotes>https://github.com/Moosync/Moosync/releases/tag/v${VERSION}</releaseNotes>@" moosync.nuspec
CHOCO_DOWNLOAD_URL="https://github.com/Moosync/Moosync/releases/download/v$VERSION/Moosync-$VERSION-win-x64.exe"
wget ${CHOCO_DOWNLOAD_URL} -O choco_download_tmp
CHOCO_CHECKSUM=$(sha256sum choco_download_tmp | cut -d' ' -f1)
rm -f choco_download_tmp
sed -i "s@\$url64 =.*@\$url64 = '$CHOCO_DOWNLOAD_URL'@" tools/chocolateyinstall.ps1
sed -i "s/checksum64     .*/checksum64     = '$CHOCO_CHECKSUM'/" tools/chocolateyinstall.ps1
chmod +x ./pack.sh
./pack.sh
cd ../

# ## Bump snap
# yarn electron:build --linux=snap
# cd dist_electron
# snap run snapcraft upload --release=stable "Moosync-${VERSION}-linux-amd64.snap"
# cd ../
