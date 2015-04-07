module.exports.settings = { 'staging': 'mongodb://bigmongo-staging.uxcas.com:27017/uno', 'serviceport' : 8181 };

var settings = module.exports.settings;

var server;

var fs = require('fs');
var http = require('http');
var qs = require('querystring');
var urlparser = require('url');
var request = require('request');

var metadatapath = "space_metadata.json";

// user space map - will be in DB
var spacemap = {}

// given a webhook (a service) what is the webservice it uses (if any) TBD list of em?
var servicehookmap = {}

// last seen space map -- again in DB
var lastspacemap = {}

// space database - will be in DB
var spacemetadata = {}

// this would be where a service would add "enter/leave" hooks
var enterhooks = {}
var leavehooks = {}

// TBD: need to be able to load modules at runtime?

// this is a SERVICE item
var hooknames = {
    speakenter: speakenter,
}

// this is a SERVICE item
var speakperspacemap = {}

// pretty time spans.
function timeSince(date) {
    
    var seconds = Math.floor((new Date() - date) / 1000);
    
    var interval = Math.floor(seconds / 31536000);
    
    if (interval > 1) {
        return interval + " years";
    }
    interval = Math.floor(seconds / 2592000);
    if (interval > 1) {
        return interval + " months";
    }
    interval = Math.floor(seconds / 86400);
    if (interval > 1) {
        return interval + " days";
    }
    interval = Math.floor(seconds / 3600);
    if (interval > 1) {
        return interval + " hours";
    }
    interval = Math.floor(seconds / 60);
    if (interval > 1) {
        return interval + " minutes";
    }
    return Math.floor(seconds) + " seconds";
}

// set up webhooks from metadata
function enableEventHooks() {
    
    // event hooks are on spaces, but are defined in services. When a space or service is edited, the hook database would need to be re-generated for the space
    // when we use a database, the space would be looked up per request. then we would know its hooks.
    
    // for now we fake it * but at least we are faking it off the real metadata
    
    // foreach space
    
    for (var spacenum = 0; spacenum < spacemetadata.spaces.length; spacenum++) {
        var space = spacemetadata.spaces[spacenum];
        
        console.log("Space: " + space.name);
        if (space.hasOwnProperty("services")) {
            var spaceservices = space.services;
            spacemap[space.uuid] = new Array();
            lastspacemap[space.uuid] = new Array();
            
            for(var sidx = 0; sidx < spaceservices.length; sidx++) {
                var serviceno = objectFindByKey(spacemetadata.services, "uuid", spaceservices[sidx]);
                if (serviceno > -1 ) {
                    var servicemeta = spacemetadata.services[serviceno];
                    console.log("  service: " + servicemeta.name);
                    if (servicemeta.hasOwnProperty("webservice")) {
                        // it's a web service that has a request field - go get THAT
                        var webno = objectFindByKey(spacemetadata.webservices, "uuid", servicemeta.webservice);
                        if (webno > -1) {
                            var webmeta = spacemetadata.webservices[webno];
                            
                            // TBD: make fast lookup for webhook by service?
                            
                            console.log("    has a webservice: " + webmeta)
                            if (servicemeta.hasOwnProperty("enterhook")) {
                                if (!enterhooks.hasOwnProperty(space.uuid)) {
                                    enterhooks[space.uuid] = new Array();
                                }
                                var spacerec = {method: hooknames[servicemeta.enterhook], request: webmeta.request};
                                enterhooks[space.uuid].push(spacerec );
                            } else {
                                servicehookmap[servicemeta.endpoint] = webmeta
                            }
                        }
                    }
                }
            }
        }
        //        enterhooks["f06ecb2f-de00-4ea6-a533-c46b217f96a2"] = new Array();
        //        enterhooks["f06ecb2f-de00-4ea6-a533-c46b217f96a2"].push({method: hooknames["speak"], request: {}} );
        
    }
    console.log(enterhooks);
}

// this enter hook is called when anyone enters a space with the speak service
function speakenter(space, rec, req) {
    
    // TODO ONLY ONCE PER DAY
    if (!speakperspacemap.hasOwnProperty(space)) speakperspacemap[space] = new Array();
    
    var existing = objectFindByKey(speakperspacemap[space], 'user', rec.user);
    // add user or update entry timestamp
    if (existing == -1) {
        speakperspacemap[space].push(rec);
    } else {
        var datenow = new Date();
        // if same day, just return. Else update date
        if ((datenow.getTime() - speakperspacemap[space][existing].time.getTime())  < 60*60*1000) {
            console.log("Already greeted " + rec.name + " in last hour");
            return;
        }
        // different day, play on.
        speakperspacemap[space][existing].time = datenow;
    }

    
    // TODO no hard coded values in here
    
    console.log("enterhook for speak ");
    
    var shortname = rec.name.split(" ")[0];
    
    // this is dependent on smart things. perhaps a generic encode of all this too?
    var msg = {"state":{"playText" : "Welcome " + shortname + " to the " + spaceName(space) + " space."}};
    
    var bodyStr = JSON.stringify(msg,
                             undefined, 1);
    
    var sendreq = req;
    console.log(req);
    console.log(sendreq);
    
    //var formData = qs.stringify(form);
    //var contentLength = formData.length;
    sendreq['body'] = bodyStr;
    sendreq.headers['Content-Length'] = bodyStr.length;
    request(sendreq, function (err, res, body) {
        console.log("SUCCESS: ", bodyStr, err);
    });
}



// load space metadata (until in DB)
// should also set up hooks if any
readspacemetadata();

// read in space config file (or get from DB)
function readspacemetadata() {
    // Read the file and send to the callback
    fs.readFile(metadatapath, handleFile)
}


// read the metadata, then start the server
function handleFile(err, data) {
    if (err) {
    } else {
        spacemetadata = JSON.parse(data);
    }
    enableEventHooks();
    makeserver();
}


// look up a record in array (like db.find)
function objectFindByKey(array, key, value) {
    for (var i = 0; i < array.length; i++) {
        //console.log(array[i][key] , value);
        if (array[i][key] === value) {
            return i;
        }
    }
    return -1;
}

// get space name from uuid
function spaceName(space) {
    var spacerec = objectFindByKey(spacemetadata["spaces"], "uuid", space);
    if (spacerec != -1) {
        return spacemetadata["spaces"][spacerec].name;
    } else return "unknown space";
}

// do all enter hooks for this service
// along with global enter hook
function doEnterHooks(space, rec) {
    rec["time"] = new Date();
    if (!spacemap.hasOwnProperty(space)) spacemap[space] = new Array();
    
    var existing = objectFindByKey(spacemap[space], 'user', rec.user);
    // add user or update entry timestamp
    if (existing == -1) {
        spacemap[space].push(rec);
    } else {
        spacemap[space][existing].time = new Date();
    }
    
    // if user had entered and left, remove from lastspacemap
    if (!lastspacemap.hasOwnProperty(space)) lastspacemap[space] = new Array();
    var oldexisting  = objectFindByKey(lastspacemap[space], 'user', rec.user);
    if (oldexisting != -1) {
        lastspacemap[space].splice(oldexisting, 1);
    }
    
    // do any service enter hooks
    console.log("enter hooks for " + spaceName(space));
    if (enterhooks.hasOwnProperty(space)) {
        for (var i = 0; i < enterhooks[space].length; i++) {
            console.log("calling enterhook");
            enterhooks[space][i].method(space, rec, enterhooks[space][i].request);
        }
    }
}

// do all exit hooks for this service
// along with global exit hook
function doExitHooks(space, rec) {
    if (!spacemap.hasOwnProperty(space)) spacemap[space] = new Array();
    var existing = objectFindByKey(spacemap[space], 'user', rec.user);
    // sanity check - kinda hard to leave if you can't find the door!
    if (existing != -1) {
        oldrec = spacemap[space][existing];
        oldrec["time"] = new Date();
        
        // update last seen in this space
        if (!lastspacemap.hasOwnProperty(space)) lastspacemap[space] = new Array();
        var oldexisting  = objectFindByKey(lastspacemap[space], 'user', rec.user);
        if (oldexisting == -1) {
            lastspacemap[space].push(oldrec);
        } else {
            lastspacemap[space][oldexisting].time = new Date();
        }
        // remove from this space
        spacemap[space].splice(existing, 1);
    }
}

// exit from all spaces (like when client closes)
function doGlobalSpaceExit(rec) {
    for(var spaceid in spacemap) {
        // exit from any space
        if (spacemap[spaceid].length > 0)
            doExitHooks(spaceid, rec);
    }
}

// service functions

// HERE service
function hereService(space, request) {
    var result = "<h1>People in the " + spaceName(space) + " space</h1><ul>";
    
    var roster = spacemap.hasOwnProperty(space) ? spacemap[space] : new Array();
    for (var i = 0; i < roster.length; i++) {
        result +=  "<li>"+spacemap[space][i].name + " entered " + timeSince(spacemap[space][i].time) + " ago</li>";
    }
    result += "</ul><hr><h2>People who were in the " + spaceName(space) + " space</h2><ul>";
    
    roster = lastspacemap.hasOwnProperty(space) ? lastspacemap[space] : new Array();
    for (var i = 0; i < roster.length; i++) {
        result +=  "<li>"+lastspacemap[space][i].name + " left " + timeSince(lastspacemap[space][i].time) + " ago</li>";
    }
    return result + "</ul>";
}

// Speak service speaks a user name ONCE per space entry per day
// The UI for this service just shows last time seen in space
function speakService(space, request) {
    return "<h2>Enter Something to say (TBD)</h2>";
}

// Hal service bridges to Huginn
function halService(space, request) {
    return "<h2>Enter a phrase HAL might understand (TBD)</h2>";
}


// generic WTF service
function unknownService(space, request) {
    return "<h2>You didn't see anything (TBD)</h2>";
}

function postState(req, deviceid, staterec) {
    var sendreq = {};
    var bodyStr = JSON.stringify({state: staterec},
                               undefined, 0);
    sendreq.body = bodyStr;
    

    sendreq.headers = req.headers;
    sendreq.headers['Content-Length'] = bodyStr.length;
    sendreq.uri = req.uri + "/" + deviceid
    sendreq.method = "PUT"
    console.log(req);
    console.log(sendreq);
    request(sendreq, function (err, res, body) {
            console.log("SUCCESS: ", bodyStr, err);
            });
    
}

// smartthingsLights
function stLightsService(space, inboundrequest, response) {
    var myresponse = response;
    // given space, find webservice
    console.log("lights - " + space);
    if (servicehookmap.hasOwnProperty("/stlights")) {
        

        var req = urlparser.parse(inboundrequest.url).pathname.split("/");
        var lightid = req[4];
        console.log(req.length);
        console.log("light id: " + lightid);

        
        req = servicehookmap["/stlights"].request;
        
        var sendreq = {};
        sendreq.headers = req.headers;
        sendreq.uri = req.uri + "/details/switch%20level"
        sendreq.method = "GET"
        console.log(req);
        console.log(sendreq);
        
        
//        sendreq.headers['Content-Length'] = bodyStr.length;
        request(sendreq, function (err, res, body) {
                console.log("SUCCESS: ", err);
                var lights = JSON.parse(body);
                if (lights.hasOwnProperty("devices")) {
                    var ret = "<h2>Lights - click to toggle on/off</h2><ul>";
                    for(var sidx = 0; sidx < lights.devices.length; sidx++) {
                        if (lights.devices[sidx].id == lightid ) {
                            console.log("TOGGLE LIGHT " + lights.devices[sidx].label);
                            // for display
                            lights.devices[sidx].state.switch =  (lights.devices[sidx].state.switch == "on") ? "off" : "on"
                            // POST STATE TO DEVICE
                            postState(req, lightid, lights.devices[sidx].state );
                        }
                
                
                        ret += "<li><a href=\"/" + space + "/service/stlights/"+lights.devices[sidx].id+"\">"+lights.devices[sidx].label+"</a> is currently "+lights.devices[sidx].state.switch + "</li>";
                
                    }
                    myresponse.end (ret + "</ul>")
                
                } else
                    myresponse.end("<h2>You didn't see anything (TBD)</h2>");

                });

        
    }

    //return "<h2>You didn't see anything (TBD)</h2>";
}


function userPage() {
    var result = "<h1>Spaces with people in them</h1><p><h2> (now, or in the past)</h2><p>Click any space to see who is there now, or who was there.<p><ul>";
    for(var spaceid in spacemap) {
        //if ((spacemap[spaceid].length > 0) || (lastspacemap[spaceid].length > 0))
        result +=  "<li><a href =\"/"+spaceid + "/service/here\">"+ spaceName(spaceid) + "</a><font size=\"-1\"> (here: " + spacemap[spaceid].length  + " past: " + lastspacemap[spaceid].length + ")<font size=\"+1\"></li>";
        
    }
    return result + "</ul>";
}

function makeserver() {
    // create the server - callback called when requests come in
    var server = http.createServer(onRequest);
    
    // we're done - except for the callback - give access to the server
    module.exports.server = server;
    
    // listen on the port
    server.listen(settings.serviceport);
    
    // nested callback function called when requests come in
    function onRequest(request, response) {
        
        var req = urlparser.parse(request.url).pathname.split("/");
        var requestBody = '';
        var space = req[1];
        var thing = req[2];
        var action = req[3];
        console.log("Space: " + space);
        console.log("Thing: " + thing);
        console.log("Action: " + action);
        
        try {
        if(request.method == "GET") {
            
            if (space.length == 0) {
                response.end("<META http-equiv=\"refresh\" content=\"60\"><body>" + userPage() + "</body>");
            } else {
                if (thing === "service") {
                    response.writeHead(200, {'Content-Type': 'text/html'});
                    if (action == "here") {
                        response.end("<META http-equiv=\"refresh\" content=\"60\"><body>" + hereService(space, request)+"</body>");
                    } else if (action == "speak") {
                        response.end(speakService(space, request));
                    } else if (action == "hal") {
                        response.end(halService(space, request));
                    } else if (action == "stlights") {
                        stLightsService(space, request, response);
                    } else {
                        response.end(unknownService(space, request));
                    }
                } else if (space === "spaces") {
                    response.writeHead(200, {'Content-Type': 'application/json'});
                    response.end(JSON.stringify(spacemetadata,
                                                undefined, 1));
                    
                } else if (thing === "users") {
                    response.writeHead(200, {'Content-Type': 'application/json'});
                    response.end(JSON.stringify({"users": spacemap.hasOwnProperty(space) ? spacemap[space] : new Array(),
                                                }, undefined, 1));
                } else {
                    response.writeHead(400, "No Space Supplied", {'Content-Type': 'text/html'});
                    response.end('<html><head><title>400</title></head><body>400: URI should end in /Channel</body></html>');
                }
            }
        } else {
            if (request.method == "PUT") {
                
                if (space.length == 0) {
                    //bad post
                    response.writeHead(400, "No Space Supplied", {'Content-Type': 'text/html'});
                    response.end('<html><head><title>400</title></head><body>400: URI should end in /Channel</body></html>');
                } else {
                    request.on('data', function(data) {
                               requestBody += data;
                               if(requestBody.length > 1e7) {
                               response.writeHead(413, "Request Entity Too Large", {'Content-Type': 'text/html'});
                               response.end('<html><head><title>413</title></head><body>413: Request Entity Too Large</body></html>');
                               }
                               });
                    request.on('end', processPut);
                    
                    function processPut() {
                        
                        // debugging
                        console.log("Data: " + requestBody);
                        
                        var rec = JSON.parse(requestBody);
                        
                        
                        if (action.length > 0) {
                            if (action == "leave") {
                                doExitHooks(space, rec);
                            } else if (action == "enter") {
                                doEnterHooks(space, rec);
                            } else if (action == "signoff") {
                                // space is ignored it should be "all"
                                doGlobalSpaceExit(rec);
                            } else {
                                
                            // error
                            }
                            
                            // return current space user list on entry or exit
                            response.writeHead(200, {'Content-Type': 'application/json'});
                            response.end(JSON.stringify({"users": spacemap.hasOwnProperty(space) ? spacemap[space] : new Array(),
                                                        }, undefined, 1));
                        } else {
                            // bad req
                            response.writeHead(400, request.method + " not supported without action", {'Content-Type': 'text/html'});
                            response.end('<html><head><title>400</title></head><body>400: Use GET</body></html>');
                        }
                    }
                    
                    
                }
                
            }  else {
                //bad post
                response.writeHead(400, request.method + " not supported", {'Content-Type': 'text/html'});
                response.end('<html><head><title>400</title></head><body>400: Wait, What?</body></html>');
            }
        }
        }
        catch (e) {
            console.log(e);
            console.log(e.stack);
            response.writeHead(400, request.method + " not supported", {'Content-Type': 'text/html'});
            response.end('<html><head><title>400</title></head><body>400: OOPS!</body></html>');
            
        }
        
        
    }
    

}

