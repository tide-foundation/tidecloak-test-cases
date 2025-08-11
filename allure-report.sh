#!/bin/bash

if [ -n "$VIRTUAL_ENV" ]; then
	pytest -v -s --alluredir=./reports 
	allure serve ./reports
else 
	echo "virtual env not active..." && exit 1
fi
