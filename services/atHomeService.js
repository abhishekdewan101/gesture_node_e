var urlparser = require('url');

var lastbulbs = "";
var lastcolor = "";
// demo service "at home"
module.exports = function (context, space, inboundrequest, response) {
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
        var stream = context.dbathomepref.findOne(query, { _id: 0 }, function (err, foundrec) {
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
            var brains = context.littlebrains.hasOwnProperty(space) ? context.littlebrains[space] : new Array();
            // look up the brain name
            var id = context.objectFindByKey(brains, 'name', littlebrain);
            if (id != -1) {
                brains[id].uri = localuri; // name MUST be uniqe, same name overrides uri
            } else {
                // look up the uri
                id = context.objectFindByKey(brains, 'uri', localuri);
                if (id != -1) {
                    brains[id].name = littlebrain; // uri MUST be uniqe, same uri overrides name
                } else {
                    // it sure looks new to me
                    brains.push({ 'name': littlebrain, 'uri': localuri })
                    context.littlebrains[space] = brains;
                }
            }
        }
        response.write("{\"settings\":[");
        // TBD read settings, return them here
        //db.athomeprefs.find({'space':"92f697df-843b-49de-a1b7-0155493f2c25", 'mode':{$exists:true}}).sort({'mode.hour':1})
        var stream = context.dbathomepref.find({'space':space, 'mode':{$exists:true}}, {_id:0}).sort({'mode.hour':1}).stream();

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
        response.end(context.littlebrains.hasOwnProperty(space)? '{"brains":'+JSON.stringify(context.littlebrains[space], undefined, 1) +"}" : '{"brains":[]}');
    } else if (requestType == "feed") {
        response.writeHead(200, {'Content-Type': 'application/json'});

        resptxt = '{"title":"messages feed","description":"latest messages","pubDate":"2014-10-08T11:06:29.858-07:00","items":[';
        
        // find who is most recently here, return their data. Regen GUID if datestamp changed
        var roster = context.spacemap.hasOwnProperty(space) ? context.spacemap[space] : new Array();
        if (roster.length == 0) {
            resptxt += "]";
            context.homespacemap[space] = null; // there is no spoon
            response.end(resptxt);
        } else {
            // pull last user from homespacemap[space]
            var lastuser = (context.homespacemap.hasOwnProperty(space) &&  (context.homespacemap[space] != null)) ? context.homespacemap[space].userrec : null;
            
            // find most recent user
            var someolddate = new Date(0);
            var newestuser = {name:"", time: someolddate};
            for (var i = 0; i < roster.length; i++) {
                //result +=  "<li>"+spacemap[space][i].name + " entered " + timeSince(spacemap[space][i].time) + " ago</li>";
                if (context.spacemap[space][i].time > newestuser.time )
                    newestuser = context.spacemap[space][i];
            }
            var change = false;
            if ((lastuser == null) || (newestuser.name != lastuser.name )) {
                // NEW USER CHANGE FEED
                console.log("user change");
                change = true;
                context.homespacemap[space] = {userrec: newestuser, guid: feedcnt++}; // uuid.v1()}
                console.log(context.homespacemap[space]);
            }
            
            // // then we expect this {"message":"this is the message","image":"this is the url","r":"0","g":"1","b":"2","guid":58628,"pubDate":"Wed, 08 Oct 2014 10:52:14 -0700"},
            
            // look up user preferences
            
            context.dbathomepref.findOne({ 'user': context.homespacemap[space].userrec.user, 'space': space }, function (err, foundrec) {
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
                resptxt += '{"speak":"' + greeting + '","guid":' + context.homespacemap[space].guid;

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

                resptxt += ',"message":"","pubDate":"' + context.homespacemap[space].userrec.time + '"}';
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
            context.dbathomepref.findOne({ 'user': useremail, 'space': space }, function (err, foundrec) {
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

                    context.dbathomepref.update({ 'user': useremail }, foundrec);
                } else {
                    context.dbathomepref.insert({ user: useremail, space: space, station: station, bulbs: bulbs, color: color, url: showurl, greeting: greeting });
                }
                sendform(context, space, response, username, useremail, station, bulbs, color, showurl, greeting);
            });
        } else {
            console.log("Lookup Settings " + useremail);
            context.dbathomepref.findOne({ 'user': useremail, 'space': space }, function (err, foundrec) {
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
                sendform(context, space, response, username, useremail, station, bulbs, color, showurl, greeting);
            });
        }
                    
    } 
}

// send a form out

function sendform(context, space, response, username, useremail, station, bulbs, color, showurl, greeting) {
    // get user prefs for this service/space
    response.writeHead(200, {'Content-Type': 'text/html'});

/*
    // read the at home template
    fs.readFile('content/athome.tmpl', 'utf8', send2);
    
    function send2 (err,data) {
            var page;
            if (err) {
                // TBD error no page
                page = "<h1>SpaceManager missing content/athome.tmpl file";
            } else {
                page = data;
            }
    };
*/    response.write("<script language=\"javascript\">\
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

        // function generates output given space, username, useremail

        // TBD the modes for this user
        var stream = context.dbathomepref.find( {'space':space, 'scene':{$exists:true}}, { _id: 0, 'scene':1,'user':1});
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

