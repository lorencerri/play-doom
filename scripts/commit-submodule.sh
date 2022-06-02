if [ -z "$1" ] || [ -z "$2" ]; then
	echo "Usage: commit-submodule.sh <submodule-name> <commit-message>"
else
	cd "$1"
	git commit -a -m "$2"
	git push
	cd ..
	git add "$1"
	git commit -m "Updated submodule $1"
	git push
fi