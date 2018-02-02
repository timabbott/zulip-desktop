@echo off
git diff-index --quiet HEAD
if %errorlevel% neq 0 (
    echo "There are uncommitted changes:"
    git status --short
    echo "Doing nothing to avoid losing your work."
    exit \B 1
)

if "%~1"=="" (
    echo "Error you must specify the PR number"
)

if "%~2"=="" ( 
    set remote="upstream"
) else (
    set remote=%2
)

set request_id="%1"
git fetch "%remote%" "pull/%request_id%/head"
git checkout -B "review-%request_id%" %remote%/master
git reset --hard FETCH_HEAD
git pull --rebase
