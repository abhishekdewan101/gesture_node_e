#!/bin/sh
#nohup supervisor -w .,services spacemgrcontroller.js &
screen -dmS spacemanager supervisor -w .,services spacemgrcontroller.js
