#!/bin/bash

if [ -z "$1" ] || [ -z "$2" ]; then
	echo "Usage: commit-submodule.sh <submodule-name> <commit-message>"
	close
fi

if [ ! -d "$1" ]; then
	echo "Submodule $1 not found"
	close
fi

cd "$1"
git commit -a -m "$2"
git push
cd ..
git add "$1"
git commit -m "Updated submodule $1"
close

close () {
	echo "press any key to exit"
	read -n 1
	exit 1
}