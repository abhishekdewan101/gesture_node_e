var urlparser = require('url');
var request = require('request');


// smartthingsLights
module.exports = function (context, space, inboundrequest, response) {
    var myresponse = response;
    // given space, find webservice
//    console.log("lights - " + space);
    var sendreq = context.getSmartThingsDeviceList("switch%20level");
    
    if (sendreq != null) {
        var req = urlparser.parse(inboundrequest.url).pathname.split("/");
        var lightid = req[4];
//        console.log(req.length);
//        console.log("light id: " + lightid);
        req = context.servicehookmap["/stlights"].request;

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
                            context.postState(req, lightid, lights.devices[sidx].state);
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
