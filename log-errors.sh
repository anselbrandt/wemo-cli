#!/bin/bash
"$@" 2>&1 | grep -i -E 'error|fail' | while read line; do
    echo "$(date '+%Y-%m-%d %H:%M:%S') $line"
done
