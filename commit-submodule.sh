#!/bin/bash

if [ -z "$1" ] || [ -z "$2" ]; then
	echo "Usage: commit-submodule.sh <submodule-name> <commit-message>"
	echo "press any key to exit"
	read -n 1
	exit 1
fi

cd doomreplay
git commit -a -m "$2"
git push
cd ..
git add "$1"
git commit -m "Updated submodule $1"

echo "press any key to exit"
read -n 1