#!/bin/bash
"$@" 2>&1 | grep Error | while read line; do
    echo "$(date '+%Y-%m-%d %H:%M:%S') $line"
done
