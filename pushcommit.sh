if [ -z "$1" ]; then
	echo "Usage: pushcommit.sh <commit-message>"
else
	git add .
	git commit -m "$1"
	git push
fi