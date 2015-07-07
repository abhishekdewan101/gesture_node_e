#!/bin/sh
#nohup supervisor -w .,services spacemgrcontroller.js &
screen -dmS spacemanager node /usr/local/bin/supervisor -w .,services spacemgrcontroller.js
