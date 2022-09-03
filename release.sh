VERSION=$(cat package.json \
  | grep version \
  | head -1 \
  | awk -F: '{ print $2 }' \
  | sed 's/[",]//g')

VERSION=$(echo $VERSION | xargs)


yarn install

cd .yarn
git clone git@github.com:Moosync/moosync_package_cache.git cache_tmp

\cp -rf cache/* cache_tmp/

# cd cache_tmp
git add -A
git commit -m "Update cache"
git tag "v$VERSION"
git push origin "v$VERSION"
git push origin main

cd ../
rm -rf cache_tmp
cd ../


## bump AUR
cd aur
sed -i "s/pkgver=.*/pkgver=${VERSION}/" PKGBUILD
updpkgsums
makepkg --printsrcinfo > .SRCINFO
git add -A
git commit -m "Bump to $VERSION"
git push origin 
cd ../

## bump flatpak
cd flatpak
python flatpak-node-generator.py yarn --electron-node-headers ../yarn.lock
sed -i "s/tag: v.*/tag: v${VERSION}/" app.moosync.moosync.yml

FLATPAK_PARTIAL_DOWNLOAD="https://github.com/Moosync/Moosync/releases/download/v"
FLATPAK_DOWNLOAD="https://github.com/Moosync/Moosync/releases/download/v$VERSION/Moosync-$VERSION-linux-x64.pacman"
sed -i "s@${FLATPAK_PARTIAL_DOWNLOAD}.*@${FLATPAK_DOWNLOAD}@" app.moosync.moosync.yml
CHECKSUM_FLATPAK=$(curl -s ${FLATPAK_DOWNLOAD} | sha256sum | cut -d' ' -f1)
echo $CHECKSUM_FLATPAK
sed -i "\@${FLATPAK_PARTIAL_DOWNLOAD}.*@{n;s@.*@        sha256: ${CHECKSUM_FLATPAK}@}" app.moosync.moosync.yml
git add -A
git commit -m "Bump to $VERSION"
git push origin
cd ../


## bump chocolatey
# cd chocolatey
# sed -i "s@<version>.*@<version>${VERSION}</version>@" moosync.nuspec
# sed -i "s@<releaseNotes>.*@<releaseNotes>https://github.com/Moosync/Moosync/releases/tag/v${VERSION}</releaseNotes>@" moosync.nuspec
# CHOCO_DOWNLOAD_URL="https://github.com/Moosync/Moosync/releases/download/v$VERSION/Moosync-$VERSION-win-x64.exe"
# CHOCO_CHECKSUM=$(curl -s ${CHOCO_DOWNLOAD_URL} | sha256sum | cut -d' ' -f1)
# echo $CHOCO_CHECKSUM
# sed -i "s@\$url64 =.*@\$url64 = '$CHOCO_DOWNLOAD_URL'@" tools/chocolateyinstall.ps1
# sed -i "s/checksum64     .*/checksum64     = '$CHOCO_CHECKSUM'/" tools/chocolateyinstall.ps1
# chmod +x ./pack.sh
# ./pack.sh


