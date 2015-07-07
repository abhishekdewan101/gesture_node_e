
// HERE service
module.exports = function (context, space, inboundrequest, request) {
    var result = "<h1>People in the " + context.spaceName(space) + " space</h1><ul>";
    
    var roster = context.spacemap.hasOwnProperty(space) ? context.spacemap[space] : new Array();
    for (var i = 0; i < roster.length; i++) {
        result +=  "<li>"+context.spacemap[space][i].name + " present " + context.timeSince(spacemap[space][i].time) + " ago</li>";
    }
    result += "</ul><hr><h2>People who were in the " + context.spaceName(space) + " space</h2><ul>";
    
    roster = context.lastspacemap.hasOwnProperty(space) ? context.lastspacemap[space] : new Array();
    for (var i = 0; i < roster.length; i++) {
        result +=  "<li>"+context.lastspacemap[space][i].name + " left " + context.timeSince(lastspacemap[space][i].time) + " ago</li>";
    }
    return result + "</ul>";
};

//module.exports.hereService = hereService;
