serverDir=`pwd`
cd $serverDir
# shut down server
git pull
yarn install
cd ../home-server-ui
git pull
yarn install
rm -rf build
yarn run build
cd $serverDir
rm -rf client
mkdir -p client
mkdir -p james-messages
mkdir -p files
mv ../home-server-ui/build/* client/