/// <reference path="typings/node/node.d.ts"/>
module.exports.settings = { 'mongo': 'mongodb://localhost:27017/uno', 'serviceport' : 8181 };

var settings = module.exports.settings;

var server;

var fs = require('fs');
var http = require('http');
var qs = require('querystring');
var urlparser = require('url');
var request = require('request');
var uuid = require('node-uuid');

var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;
var mydb;
var feedcnt = 1;

var dbspaces;
var dbeventlog;
var dbathomepref;

// open mongo
module.exports.connect = function () { MongoClient.connect(settings.mongo, connected2);};

// close mongo
module.exports.disconnect = function() { mydb.close(); };


var metadatapath = "space_metadata.json";

// brains
var littlebrains = {};

// Home Service GUID/User Map
var homespacemap = {};

// user space map - will be in DB
var spacemap = {};

// given a webhook (a service) what is the webservice it uses (if any) TBD list of em?
var servicehookmap = {};

// last seen space map -- again in DB
var lastspacemap = {};

// space database - will be in DB
var spacemetadata = {};

// this would be where a service would add "enter/leave" hooks
var enterhooks = {};
var leavehooks = {};

// TBD: need to be able to load modules at runtime?

// this is a SERVICE item
var hooknames = {
    speakenter: speakenter,
};

// this is a SERVICE item
var speakperspacemap = {};


// event logging
function logEventToDb(evt) {
    dbeventlog.insert(evt);
};

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
};

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
                            
                            console.log("    has a webservice: " + webmeta);
                            if (servicemeta.hasOwnProperty("enterhook")) {
                                if (!enterhooks.hasOwnProperty(space.uuid)) {
                                    enterhooks[space.uuid] = new Array();
                                }
                                var spacerec = {method: hooknames[servicemeta.enterhook], request: webmeta.request};
                                enterhooks[space.uuid].push(spacerec );
                            } else {
                                servicehookmap[servicemeta.endpoint] = webmeta;
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
};

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
};


function IdleTimeout() {
    console.log("periodic timeout"); 
    // exit old users from all spaces
    var now = new Date();
    for(var spaceid in spacemap) {
        // exit from any space
        console.log ("space: " + spaceid)
        if (spacemap[spaceid].length > 0) {
            
            var array = spacemap[spaceid];
            var exits = new Array();
            // for each expired user
            for (var i = 0; i < array.length; i++) {
                if ((now - array[i].time) > 180000) {
                    // three minute timeout
                    console.log(array[i]);
                    exits.push(array[i]);
                }
            }
            // now exit them all 
            for (var j = 0; j < exits.length; j++) {
                console.log(array[i]);
                doExitHooks(spaceid, exits[j]);
            }
        }
    }    
}

//
// callback for connect call - finish connecting to mongo, make sure all indexes we need exist
//
function connected2(err, db) {
    if(err) { console.log("Could not connect to mongod, check config."); throw err;}
    
    // use db;
    mydb = db;
    dbspaces = db.collection('spacemap');
    dbeventlog = db.collection('eventlog');
    dbathomepref = db.collection('athomeprefs');
    console.log("db up", dbspaces);
    
    setInterval(IdleTimeout, 60000);
    
    // make sure we have indexes
//    mydb.collection('schedule-events').ensureIndex({prgSvcId:1, startTime:1}, function (err, val) {});
//    mydb.collection('programs').ensureIndex({TMSid : 1 }, function (err, val) {});
//    mydb.collection('lineups').ensureIndex({headendId:1}, function (err, val) {});
//    mydb.collection('sources').ensureIndex({prgSvcId : 1}, function (err, val) {});
    
    
    // load space metadata (until in DB)
    // should also set up hooks if any
    readspacemetadata();
}

//readspacemetadata();

// THIS IS MAIN
module.exports.connect();

// read in space config file (or get from DB)
function readspacemetadata() {
    // Read the file and send to the callback
    fs.readFile(metadatapath, handleFile);
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


// do all enter hooks for this service if dohooks is true
// along with global enter hook
function doEnterOptHooks(space, rec, dohooks) {
    rec["time"] = new Date();
    
    // console.log("mongo call");
    // mongo parallel - eventually will be only thing used but then need to defer finishing callback until its done
    dbspaces.findOne({ 'uuid': space, 'user': rec.user }, function (err, foundrec) {
        if (err) {

            console.log(err);
            console.log("mongo call error");
        }
        if (foundrec) {
            // make "old" record active
            console.log("Found Old for ", space, rec.user, foundrec);
            foundrec.time = rec.time;
            foundrec.present = true;
            dbspaces.save(foundrec, function (err, rec) { if (err) { console.log(err); } });
        } else {
            // add record
            console.log("Add New for ", space, rec.user, rec);
            dbspaces.insert({ 'uuid': space, 'user': rec.user, 'time': rec.time, 'present': true });
        }

        console.log("mongo done");
                     
        // enter hook processing here
        // web request callback finishes here
    });

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
    var oldexisting = objectFindByKey(lastspacemap[space], 'user', rec.user);
    if (oldexisting != -1) {
        lastspacemap[space].splice(oldexisting, 1);
    }

    if (dohooks) {
        // do any service enter hooks
        console.log("enter hooks for " + spaceName(space));
        if (enterhooks.hasOwnProperty(space)) {
            for (var i = 0; i < enterhooks[space].length; i++) {
                console.log("calling enterhook");
                enterhooks[space][i].method(space, rec, enterhooks[space][i].request);
            }
        }
    }
}

// do global and service enter hooks
function doEnterHooks(space, rec) {
    doEnterOptHooks(space, rec, true);
}

// do global enter hook only
function doRefreshHooks(space, rec) {
    doEnterOptHooks(space, rec, false);
}


// do all exit hooks for this service
// along with global exit hook
function doExitHooks(space, rec) {
    // mongo parallel - eventually will be only thing used but then need to defer finishing callback until its done
    dbspaces.findOne({ 'uuid': space, 'user': rec.user }, function (err, foundrec) {
        if (err) console.log(err);
        if (foundrec) {
            console.log("Found Old for ", space, rec.user, foundrec);
            // make "old" record inactive
            foundrec.time = new Date();
            foundrec.present = false;
            dbspaces.save(foundrec, function (err, rec) { if (err) { console.log(err); } });
        } else {
            // THIS IS NOT SUPPOSED TO HAPPEN
            console.log("THIS IS NOT SUPPOSED TO HAPPEN - LEAVE WITHOUT ENTER. MIND BLOWN");
            // add record
            dbspaces.insert({ 'uuid': space, 'user': rec.user, 'time': rec.time, 'present': false });
        }
        // exit hook processing here
        // web request callback finishes here
    });

    
    if (!spacemap.hasOwnProperty(space)) spacemap[space] = new Array();
    var existing = objectFindByKey(spacemap[space], 'user', rec.user);
    // sanity check - kinda hard to leave if you can't find the door!
    if (existing != -1) {
        var oldrec = spacemap[space][existing];
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
        result +=  "<li>"+spacemap[space][i].name + " present " + timeSince(spacemap[space][i].time) + " ago</li>";
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
    sendreq.uri = req.uri + "/" + deviceid;
    sendreq.method = "PUT";
    console.log(req);
    console.log(sendreq);
    request(sendreq, function (err, res, body) {
            console.log("SUCCESS: ", bodyStr, err);
            });
    
}

// return a smart things light list request object
function getSmartThingsDeviceList(capabiltiy) {
    var req = null;
    
    if (servicehookmap.hasOwnProperty("/stlights")) {
        req = servicehookmap["/stlights"].request;
        
        delete req.headers['Content-Length']; // if it happens to be there
        
        var sendreq = {};
        sendreq.headers = req.headers;
        sendreq.uri = req.uri + "/details/"+capabiltiy;
        sendreq.method = "GET";
        sendreq.followRedirect = true;
        console.log(req);
        console.log(sendreq);
    }
    return sendreq;

    
}

// send a form out

function sendform(space, response, username, useremail, station, bulbs, color, showurl, greeting) {
    // get user prefs for this service/space
    response.writeHead(200, {'Content-Type': 'text/html'});
    response.write("<script language=\"javascript\">\
function toggle(tx,el) {\
	var ele = document.getElementById(el);\
	var text = document.getElementById(tx);\
	if(ele.style.display == \"block\") {\
    		ele.style.display = \"none\";\
		text.innerHTML = \"Show\";\
  	}\
	else {\
		ele.style.display = \"block\";\
		text.innerHTML = \"Hide\";\
	}\
} \
</script>\
<a id=\"d1\" href='javascript:toggle(\"d1\",\"t1\");'>Show</a> Scenes\
<div id=\"t1\" style=\"display: none\">");

        // TBD the modes for this user
        var stream = dbathomepref.find( {'space':space, 'scene':{$exists:true}}, { _id: 0, 'scene':1,'user':1});
                // handle the stream events
        stream.on("data", processscene);
        stream.on("end", processsceneend);

        
        function processscene(item) {
            var name = "";
            var userfield = "";
            console.log(item);
            if (item.hasOwnProperty("user")) {
                if ((item.user != "") && (item.user != useremail))
                    return; // skip it
                else if (item.user != "") {
                    name = "Your scene"
                    userfield = ",\\\"user\\\":\\\""+item.user+"\\\"";
                }
            }
            if (item.hasOwnProperty("scene") && (item.scene != "") )
                    if (name != "")
                        name += " named " + item.scene;
                    else
                        name = item.scene;
            response.write("<a href='javascript:window.JSInterface.sendMode(\"{\\\"scene\\\":\\\"" + item.scene +"\\\""+userfield+"}\");'>" + name + "</a><br>");
                //JSON.stringify(item, undefined, 1));
        }
        
        function processsceneend() {      
            response.write("</div><p></p><a id=\"d2\" href='javascript:toggle(\"d2\",\"t2\");'>Show</a> Preferences\
        <div id=\"t2\" style=\"display: none\">");
        	
            response.write("<h2>Your At Home Preference Page</h2>");
            response.write("<p>" + username + ", select your home preferences:<p>");
            
            response.write('<form name="feedback" method="get"  action="athome">');
            response.write('Radio Station: <input type="text" name="station" size="25" value="' + station + '"><p>');
            response.write('Lighbulb Names: <input type="text" name="bulbs" size="25" value="' + bulbs + '"><p>');
            response.write('Light Color (0-99): <input type="text" name="color" size="25" value="' + color + '"><p>');
            response.write('Personal Greeting: <input type="text" name="greeting" size="25" value="' + greeting + '"><p>');
            response.write('Web Site: <input type="text" name="url" size="25" value="' + showurl + '"><p>');
            response.write('<input type="hidden" name="user" value="' + useremail + '">');
            response.write('<input type="hidden" name="name" value="' + username + '">');
            response.write('<input type="hidden" name="save" value="1">');
            response.end('<input type="submit" value="Save"></form></div>');
        }
}

function setHueBulbs(bulbs, color) {
    var sendreq = getSmartThingsDeviceList("color%20control");
    var req = servicehookmap["/stlights"].request;
    var bulbarray = bulbs.split(",");
    for  (var i = 0; i< bulbarray.length; i++) {
        bulbarray[i] = bulbarray[i].trim().toLowerCase();
    }
    
    // color name to hue?
    /* orange = 9
     green = 35
     blue = 71
     purple = 90
     red = 102
     */
    var hue;
    if (parseInt(color) >= 0) {
        hue = parseInt(color);
    } else {
        switch (color.toLowerCase()) {
            case 'red':
                hue = 102;
                break;
            case 'green':
                hue = 35;
                break;
            case 'blue':
                hue = 71;
                break;
            case 'purple':
                hue = 90;
                break;
            case 'orange':
                hue = 9;
                break;
            default:
                hue = 15;
                break;
        }
    }
    if (sendreq != null) {
        request(sendreq, function (err, res, body) {
            console.log("SUCCESS: ", err);
            try {
                var lights = JSON.parse(body);
                if (lights.hasOwnProperty("devices")) {

                    for (var sidx = 0; sidx < lights.devices.length; sidx++) {
                        if (bulbarray.indexOf(lights.devices[sidx].label.toLowerCase()) > -1) {
                            console.log("set light color " + lights.devices[sidx].label + " to " + color);

                            // lights.devices[sidx].state = { 'hue': hue }; // use hue
                            // delete lights.devices[sidx].state.color; // ignore color
                            // POST STATE TO DEVICE
                            postState(req, lights.devices[sidx].id, { 'hue': hue });
                        }
                    }
                }
            } catch (e) {
                console.log(e);
                console.log(body);
            }
        });

    }
}

// top level request for all brains
function allbrains(response) {
        var count = 0;
        
        response.writeHead(200, {'Content-Type': 'application/json'});
        response.write('{"allbrains":[');
        
        for (var spaceid in littlebrains) {
            if (littlebrains.hasOwnProperty(spaceid)) {
                if (count++ > 0) response.write(",");

                response.write('{"space": "'+spaceid+'", "brains":'+JSON.stringify(littlebrains[spaceid], undefined, 1) +"}");
            }
        }
        response.end(']}');
}

var lastbulbs = "";
var lastcolor = "";
// demo service "at home"
function atHomeService(space, inboundrequest, response) {
    var myresponse = response;
    console.log("athome - " + space);
    
    // This is either the settings page for the user, or the RSS feed. The RSS feed should serve out content for the current user including
    // media to play, greeting, info page URL
    // {image, speak, music...
    
    // header is 108 chars
    // {"title":"messages feed","description":"latest messages","pubDate":"2014-10-08T11:06:29.858-07:00","items":[
    // read 108 chars until we get past
    // "items":[
    // then we expect this {"message":"this is the message","image":"this is the url","r":"0","g":"1","b":"2","guid":58628,"pubDate":"Wed, 08 Oct 2014 10:52:14 -0700"},
    
    // check for feed request
    var parsedreq = urlparser.parse(inboundrequest.url, true);
    //console.log(parsedreq.query);
    var req = parsedreq.pathname.split("/");
    var resptxt;
    var requestType = req[4];
    // console.log(req.length);
    console.log("feed: " + requestType);
    
    
    // request is http://site/SPACE/service/SERVICE/REQUESTTYPE

    
    if (requestType == "scene") {
        response.writeHead(200, {'Content-Type': 'application/json'});
        // read user and scene from request
        // get settings for space itself
        var sceneuser = parsedreq.query.user;
        var scenename = parsedreq.query.scene;
        var query = {'space':space};
        if ((sceneuser != null) && (sceneuser != "")) query['user'] = sceneuser;
        if ((scenename != null) && (scenename != "")) query['scene'] = scenename;
        else query['scene'] = "";
        var stream = dbathomepref.findOne(query, { _id: 0 }, function (err, foundrec) {
            if (err) {
                console.log(err);
                console.log("mongo call error");
                response.write("{}");

            } else
                if (foundrec) {
                    response.write(JSON.stringify(foundrec, undefined, 1));
                }
                else
                    response.write("{}");

            response.end("");
        });
                
    } else if (requestType == "settings") {
        // return the settings for the space - that would be the background pattern for the space.
        // is this working? Need to test.
        // TBD STATUS request to little brain needs to return detailed page of what its doing.
        
        // setting request from a littlebrain include settings?name=brain&uri=brainwebaddress (in local space)
        // TBD support multiple brains
        // ISSUE: brain refresh/timeout
        
        response.writeHead(200, {'Content-Type': 'application/json'});
        // read URI from request
        // get settings for space itself
        var littlebrain = parsedreq.query.name;
        var localuri = parsedreq.query.uri;
        var count = 0;
        
        if (((typeof littlebrain !== 'undefined') && littlebrain) && ((typeof localuri !== 'undefined') && localuri)) {
            // support multiple brains
            var brains = littlebrains.hasOwnProperty(space) ? littlebrains[space] : new Array();
            // look up the brain name
            var id = objectFindByKey(brains, 'name', littlebrain);
            if (id != -1) {
                brains[id].uri = localuri; // name MUST be uniqe, same name overrides uri
            } else {
                // look up the uri
                id = objectFindByKey(brains, 'uri', localuri);
                if (id != -1) {
                    brains[id].name = littlebrain; // uri MUST be uniqe, same uri overrides name
                } else {
                    // it sure looks new to me
                    brains.push({ 'name': littlebrain, 'uri': localuri })
                    littlebrains[space] = brains;
                }
            }
        }
        response.write("{\"settings\":[");
        // TBD read settings, return them here
        //db.athomeprefs.find({'space':"92f697df-843b-49de-a1b7-0155493f2c25", 'mode':{$exists:true}}).sort({'mode.hour':1})
        var stream = dbathomepref.find({'space':space, 'mode':{$exists:true}}, {_id:0}).sort({'mode.hour':1}).stream();

        // handle the stream events
        stream.on("data", processsetting);
        stream.on("end", processend);

        function processsetting(item) {
            if (count++ > 0) response.write(",");
            response.write(JSON.stringify(item, undefined, 1));
        }
        
        function processend() {
            response.end("]}");
        }

    } else if (requestType == "brains") {
        // return the current littlebrain uri
        // TBD return a LIST of littlebrains
        response.writeHead(200, {'Content-Type': 'application/json'});
        response.end(littlebrains.hasOwnProperty(space)? '{"brains":'+JSON.stringify(littlebrains[space], undefined, 1) +"}" : '{"brains":[]}');
    } else if (requestType == "feed") {
        response.writeHead(200, {'Content-Type': 'application/json'});

        resptxt = '{"title":"messages feed","description":"latest messages","pubDate":"2014-10-08T11:06:29.858-07:00","items":[';
        
        // find who is most recently here, return their data. Regen GUID if datestamp changed
        var roster = spacemap.hasOwnProperty(space) ? spacemap[space] : new Array();
        if (roster.length == 0) {
            resptxt += "]";
            homespacemap[space] = null; // there is no spoon
            response.end(resptxt);
        } else {
            // pull last user from homespacemap[space]
            var lastuser = (homespacemap.hasOwnProperty(space) &&  (homespacemap[space] != null)) ? homespacemap[space].userrec : null;
            
            // find most recent user
            var someolddate = new Date(0);
            var newestuser = {name:"", time: someolddate};
            for (var i = 0; i < roster.length; i++) {
                //result +=  "<li>"+spacemap[space][i].name + " entered " + timeSince(spacemap[space][i].time) + " ago</li>";
                if (spacemap[space][i].time > newestuser.time )
                    newestuser = spacemap[space][i];
            }
            var change = false;
            if ((lastuser == null) || (newestuser.name != lastuser.name )) {
                // NEW USER CHANGE FEED
                console.log("user change");
                change = true;
                homespacemap[space] = {userrec: newestuser, guid: feedcnt++}; // uuid.v1()}
                console.log(homespacemap[space]);
            }
            
            // // then we expect this {"message":"this is the message","image":"this is the url","r":"0","g":"1","b":"2","guid":58628,"pubDate":"Wed, 08 Oct 2014 10:52:14 -0700"},
            
            // look up user preferences
            
            dbathomepref.findOne({ 'user': homespacemap[space].userrec.user, 'space': space }, function (err, foundrec) {
                var station = null;
                var color = null;
                var greeting = "Hi! You need to set your preferences for the At Home Service";
                var bulbs = null;
                var showurl = null;


                if (err) {
                    console.log(err);
                    console.log("mongo call error");
                }
                if (foundrec) {
                    color = foundrec.color == "undefined" ? null : foundrec.color;
                    bulbs = foundrec.bulbs == "undefined" ? null : foundrec.bulbs;
                    greeting = foundrec.greeting;
                    station = foundrec.station;
                    showurl = foundrec.url;
                } else {
                    showurl = "http://m.memegen.com/ytpj63.jpg";
                }
                resptxt += '{"speak":"' + greeting + '","guid":' + homespacemap[space].guid;

                if (station != null) {
                    resptxt += ', "station":"' + station + '"';
                }

                if (showurl != null) {
                    resptxt += ', "image":"' + showurl + '"';
                }
                                 
                if (bulbs != null) {
                    resptxt += ', "bulbs":"' + bulbs + '"';
                }
                if (color != null) {
                    resptxt += ', "color":"' + color + '"';
                }
                                 
                // Don't do the bulbs here - the little brain handles them so pass them down

                /*if ((bulbs != null ) && (color != null)) {
                   if ((bulbs != lastbulbs) || (color != lastcolor)) {
                       setHueBulbs(bulbs, color);
                
                lastcolor = color;
                lastbulbs = bulbs;
                */
                //}
                //}

                resptxt += ',"message":"","pubDate":"' + homespacemap[space].userrec.time + '"}';
                response.end(resptxt);

            });
        }

    }
    else {
        var username = parsedreq.query.name;
        var useremail = parsedreq.query.user;
        var save = parsedreq.query.save;
        
        var station = parsedreq.query.station;
        var color = parsedreq.query.color;
        var greeting = parsedreq.query.greeting;
        var bulbs = parsedreq.query.bulbs;
        var showurl = parsedreq.query.url;
        
        if (save == "1") {
            console.log("Save Settings");
            dbathomepref.findOne({ 'user': useremail, 'space': space }, function (err, foundrec) {
                if (err) {
                    console.log(err);
                    console.log("mongo call error");
                }
                if (foundrec) {
                    foundrec.color = color;
                    foundrec.greeting = greeting;
                    foundrec.station = station;
                    foundrec.bulbs = bulbs;
                    foundrec.url = showurl;

                    dbathomepref.update({ 'user': useremail }, foundrec);
                } else {
                    dbathomepref.insert({ user: useremail, space: space, station: station, bulbs: bulbs, color: color, url: showurl, greeting: greeting });
                }
                sendform(space, response, username, useremail, station, bulbs, color, showurl, greeting);
            });
        } else {
            console.log("Lookup Settings " + useremail);
            dbathomepref.findOne({ 'user': useremail, 'space': space }, function (err, foundrec) {
                if (err) {
                    console.log(err);
                    console.log("mongo call error");
                }
                if (foundrec) {
                    console.log(foundrec);
                    color = foundrec.color;
                    bulbs = foundrec.bulbs;
                    greeting = foundrec.greeting;
                    station = foundrec.station;
                    showurl = foundrec.url;
                } else {
                    console.log("{'user': " + useremail + "} not found");
                }
                sendform(space, response, username, useremail, station, bulbs, color, showurl, greeting);
            });
        }
                    
    }

   
}


// smartthingsLights
function stLightsService(space, inboundrequest, response) {
    var myresponse = response;
    // given space, find webservice
    console.log("lights - " + space);
    var sendreq = getSmartThingsDeviceList("switch%20level");
    
    if (sendreq != null) {
        var req = urlparser.parse(inboundrequest.url).pathname.split("/");
        var lightid = req[4];
//        console.log(req.length);
//        console.log("light id: " + lightid);
        req = servicehookmap["/stlights"].request;

        request(sendreq, function (err, res, body) {
            console.log("SUCCESS: ", err);
            try {
                var lights = JSON.parse(body);
                if (lights.hasOwnProperty("devices")) {
                    var ret = "<h2>Lights - click to toggle on/off</h2><ul>";
                    for (var sidx = 0; sidx < lights.devices.length; sidx++) {
                        if (lights.devices[sidx].id == lightid) {
                            console.log("TOGGLE LIGHT " + lights.devices[sidx].label);
                            // for display
                            lights.devices[sidx].state.switch = (lights.devices[sidx].state.switch == "on") ? "off" : "on";
                            // POST STATE TO DEVICE
                            postState(req, lightid, lights.devices[sidx].state);
                        }


                        ret += "<li><a href=\"/" + space + "/service/stlights/" + lights.devices[sidx].id + "\">" + lights.devices[sidx].label + "</a> is currently " + lights.devices[sidx].state.switch + "</li>";

                    }
                    myresponse.end(ret + "</ul>");

                } else
                    myresponse.end("<h2>You didn't see anything (TBD)</h2>");
            } catch (e) {
                console.log(e);
                console.log(body);
                myresponse.end("<h2>Something Unexpected Happened. Try again later.</h2>");
            }

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
        
        var parsedreq = urlparser.parse(request.url, true);
        console.log(parsedreq.query);
        var req = parsedreq.pathname.split("/");

        //var req = urlparser.parse(request.url).pathname.split("/");
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
                response.writeHead(200, {'Content-Type': 'text/html'});
                response.end("<META http-equiv=\"refresh\" content=\"60\"><body>" + userPage() + "</body>");
            } else {
                if (thing === "service") {
                    
                    if (parsedreq.query.hasOwnProperty("user")) {
                        logEventToDb({'raw': {user: parsedreq.query.user, name: parsedreq.query.name}, 'space':space, 'message': parsedreq.query.name + " ran service " + action + " in space " + spaceName(space)});
                        }
                    
                    if (action == "here") {
                        response.writeHead(200, {'Content-Type': 'text/html'});
                        response.end("<META http-equiv=\"refresh\" content=\"60\"><body>" + hereService(space, request)+"</body>");
                    } else if (action == "speak") {
                        response.writeHead(200, {'Content-Type': 'text/html'});
                        response.end(speakService(space, request));
                    } else if (action == "hal") {
                        response.writeHead(200, {'Content-Type': 'text/html'});
                        response.end(halService(space, request));
                    } else if (action == "stlights") {
                        response.writeHead(200, {'Content-Type': 'text/html'});
                        stLightsService(space, request, response);
                    } else if (action == "athome") {
                        atHomeService(space, request, response);
                    } else {
                        response.writeHead(200, {'Content-Type': 'text/html'});
                        response.end(unknownService(space, request));
                    }
                } else if (space === "allbrains") {
                    allbrains(response);
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
                    request.on('data', function (data) {
                        requestBody += data;
                        if (requestBody.length > 1e7) {
                            response.writeHead(413, "Request Entity Too Large", { 'Content-Type': 'text/html' });
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
                                logEventToDb({'raw': rec, 'space':space, 'message': rec.name + " left " + spaceName(space) + " space"});
                                doExitHooks(space, rec);
                            } else if (action == "enter") {
                                logEventToDb({'raw': rec, 'space':space, 'message': rec.name + " entered " + spaceName(space) + " space"});
                                doEnterHooks(space, rec);
                            } else if (action == "refresh") {
                                logEventToDb({'raw': rec, 'space':space, 'message': rec.name + " refreshed presence in " + spaceName(space) + " space"});
                                doRefreshHooks(space, rec);
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

