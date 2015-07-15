/// <reference path="typings/node/node.d.ts"/>
module.exports.settings = { 'mongo': 'mongodb://localhost:27017/uno', 'serviceport' : 8181, 'rabbitmq':  'amqp://54.183.57.29'};

var settings = module.exports.settings;

var server = null;

var fs = require('fs');
var http = require('http');
var qs = require('querystring');
var urlparser = require('url');
var request = require('request');
var uuid = require('node-uuid');
var util = require('util');
var reqall = require('require-all');

//ar amqp = require('amqplib');
var amqp = require('amqplib/callback_api')
var when = require('when');


// load services (could we reload these?)
var services;

function loadAll() {
  services = reqall({
  dirname     :  __dirname + '/services',
  filter      :  /(.+Service)\.js$/,
  excludeDirs :  /^\.(git|svn)$/
});
}

loadAll();

// services now is an object with references to all modules matching the filter
// for example:
// { HomeService: function HomeService() {...}, ...}


var MongoClient = require('mongodb').MongoClient;
var RabbitClient;
var ObjectID = require('mongodb').ObjectID;
var mydb;
var feedcnt = 1;

var dbspaces;
var dbeventlog;
var dbathomepref;

// open mongo
module.exports.connect = function () { console.log("Startup"); amqp.connect(settings.rabbitmq, connected1); };

function connected1(err, conn) {
    console.log("amqp callback.")
        RabbitClient = conn;
        MongoClient.connect(settings.mongo, connected2);
}

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
                if ((now - array[i].time) > 1800000) {
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

// set up global context 
var context;


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

// for each space, create a publish endpoint 
// we only broadcast "Enter" and "Leave" events

var RabbitChannel;

function connectPublishers() {
     RabbitClient.createChannel(function (err, ch) {
         console.log("channel created");
        RabbitChannel = ch;
        for (var spacenum = 0; spacenum < spacemetadata.spaces.length; spacenum++) {
            var space = spacemetadata.spaces[spacenum];
                var ex = space.uuid;
                //var ok = ch.assertQueue(ex);
                //var exchange = ch.assertExchange('amq.fanout');  
                var exchange = ch.assertExchange(ex, 'fanout', {durable: false});   
                //ch.bindQueue(ex, 'amq.fanout');     
                 console.log(space.uuid + " exchange created");
        }
     });
}

// read the metadata, then start the server
function handleFile(err, data) {
    if (err) {
    } else {
        spacemetadata = JSON.parse(data);
    }
    enableEventHooks();
    connectPublishers(); // we have all space guids connect to rabbitmq channels
    
    context = { 
    // global data structures
    spacemap: spacemap, 
    lastspacemap: lastspacemap, 
    littlebrains: littlebrains,
    dbathomepref: dbathomepref,
    homespacemap: homespacemap,
    servicehookmap: servicehookmap,
    // global fns
    RabbitClient: RabbitClient,     // needed?
    RabbitChannel: RabbitChannel,   // needed?
    spaceName: spaceName, 
    timeSince: timeSince,
    postState: postState,
    objectFindByKey: objectFindByKey,
    getSmartThingsDeviceList: getSmartThingsDeviceList
    };

    if (server == null) makeserver();
    
    // testing
//    console.log(util.inspect(services, false, null));
//    console.log(services["hereService"](context, "f06ecb2f-de00-4ea6-a533-c46b217f96a2", null));

//    process.exit();
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
    // broadcast an enter event
    RabbitChannel.publish(space, '', new Buffer('{"presence":"enter"}'));
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
    // broadcast an enter event
    RabbitChannel.publish(space, '', new Buffer('{"presence":"leave"}'));
}

// exit from all spaces (like when client closes)
function doGlobalSpaceExit(rec) {
    for(var spaceid in spacemap) {
        // exit from any space
        if (spacemap[spaceid].length > 0)
            doExitHooks(spaceid, rec);
    }
}

// service functions are loaded from services directory

// support functions for smartThings

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
    server = http.createServer(onRequest);
    
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
                        response.end("<META http-equiv=\"refresh\" content=\"60\"><body>" + services.hereService(context, space, request, response)+"</body>");
                    } else if (action == "speak") {
                        response.writeHead(200, {'Content-Type': 'text/html'});
                        response.end(services.speakService(context, space, request, response));
                    } else if (action == "hal") {
                        response.writeHead(200, {'Content-Type': 'text/html'});
                        response.end(services.halService(context, space, request, response));
                    } else if (action == "stlights") {
                        response.writeHead(200, {'Content-Type': 'text/html'});
                        services.stLightsService(context, space, request, response);
                    } else if (action == "athome") {
                        services.atHomeService(context, space, request, response);
                    } else {
                        response.writeHead(200, {'Content-Type': 'text/html'});
                        response.end(services.unknownService(context, space, request, response));
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

