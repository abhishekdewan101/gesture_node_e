//load the required libraries
var leap = require('leapjs');
// var plugins = require('leapjs-plugins')
var amqp = require('amqplib/callback_api');
var when = require('when');


var spaceWithImage = "tv";

var rabbitMQServer = 'amqp://54.183.57.29';
var RabbitClient;
var RabbitChannel;
var space = "92f697df-843b-49de-a1b7-0155493f2c25"//UUID of the space we are talking too.
var selected = false;
console.log("Starting Up Message Bus");
amqp.connect(rabbitMQServer,busConnected);

function busConnected(err,conn){
  if(conn != null){
    console.log("Connected to Message Bus");
  }else{
    console.log(err);
  }
  RabbitClient = conn;
  console.log("Establishing connection to Channel");
  RabbitClient.createChannel(function(err,ch){
    if(ch != null){
      console.log("Channel Connected");
      RabbitChannel = ch;

      leap.loop({
        enableGestures : true,
        frame: function(frame){
          var hands = frame.hands;
          if(hands.length != 0){
            var gestureData = frame.gestures;
            if(gestureData.length !=0){
              var gesture = gestureData[gestureData.length - 1];
              if(gesture.state === 'stop'){
                switch(gesture.type){
                  case "keyTap":
                        selected = true;
                        console.log("Object selected - " + selected);
                        break;
                  case "swipe":
                        if(selected == true){
                          var directionX = gesture.direction[0];
                          var directionY = gesture.direction[1];
                          var directionZ = gesture.direction[2];
                          var absX = Math.abs(directionX);
                          var absY = Math.abs(directionY);
                          var absZ = Math.abs(directionZ);
                          var target;
                          var source = spaceWithImage;
                          if(absX > absY && absX > absZ){
                            if(directionX > 0){
                              target = getTarget("RIGHT")
                              RabbitChannel.publish(space,'',new Buffer('{"command":"switch","source":'+source+',"target":'+target+'}'));
                              console.log("Object sent from " + source + " to " + target);
                              console.log('{"command":"switch","source":'+source+',"target":'+target+'}');
                            }else{
                              target= getTarget("LEFT")
                              RabbitChannel.publish(space,'',new Buffer('{"command":"switch","source":'+source+',"target":'+target+'}'));
                              console.log("Object sent from " + source + " to " + target);
                              console.log('{"command":"switch","source":'+source+',"target":'+target+'}');
                            }
                          }else{
                            if(absY > absX && absY > absZ){
                              if(directionY > 0){
                                target = getTarget("UP")
                                RabbitChannel.publish(space,'',new Buffer('{"command":"switch","source":'+source+',"target":'+target+'}'));
                                console.log("Object sent from " + source + " to " + target);
                                console.log('{"command":"switch","source":'+source+',"target":'+target+'}');
                              }else{
                                target = getTarget("DOWN")
                                RabbitChannel.publish(space,'',new Buffer('{"command":"switch","source":'+source+',"target":'+target+'}'));
                                console.log("Object sent from " + source + " to " + target);
                                console.log('{"command":"switch","source":'+source+',"target":'+target+'}');
                              }
                            }
                          }
                          selected = false;
                          break;
                        }
                }
              }
            }
          }
      }
      });

    }
  });
}

function getTarget(direction){
  switch(direction){
    case "RIGHT":
          if(spaceWithImage === "tv" || spaceWithImage === "center"){
            spaceWithImage = "right";
            return spaceWithImage;
          }

          if(spaceWithImage === "left"){
            spaceWithImage = "tv";
            return spaceWithImage;
          }
          break;

    case "LEFT":
          if(spaceWithImage === "tv" || spaceWithImage === "center"){
            spaceWithImage = "left";
            return spaceWithImage;
          }

          if(spaceWithImage === "right"){
            spaceWithImage = "tv";
            return spaceWithImage;
          }
          break;

    case "UP":
          if(spaceWithImage === "tv" || spaceWithImage === "left" || spaceWithImage === "right"){
            spaceWithImage = "center"
            return spaceWithImage;
          }
          break;

    case "DOWN":
          if(spaceWithImage == "center"){
            spaceWithImage = "tv";
            return spaceWithImage;
          }
          break;
  }
}
