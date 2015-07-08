# unospacemanager
Space Manager

The space manager should be cloned into a directory, and run using `  ./startspacemgr`

On a production machine this repo will typically be cloned into `  ~/production/unospacemanager`

So, for production, ssh into the machine, cd to the target directory, and run `./startspacemgr`

The service will start in a screen session named spacemanager, and you will be returned to the shell. You may exit the ssh session safely. To see the currently running spacemanager, simply run `screen -r`. To detach, press `ctrl-a` then `d`. 

If there are changes checked into the master branch, git pull them into the prodution directory. The service should automatically reload when the new files are detected. 
