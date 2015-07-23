module.exports.settings = { 'mongo': 'mongodb://localhost:27017/uno', 'serviceport' : 8181, 'rabbitmq':  'amqp://54.183.57.29'};

var settings = module.exports.settings;

var server = null;

// var fs = require('fs');
// var http = require('http');
// var qs = require('querystring');
// var urlparser = require('url');
// var request = require('request');
// var uuid = require('node-uuid');
// var util = require('util');
// var reqall = require('require-all');

//leap motion dependancies
var leap = require('leapjs');

//ar amqp = require('amqplib');
var amqp = require('amqplib/callback_api')
var when = require('when');


// // load services (could we reload these?)
// var services;
//
// function loadAll() {
//   services = reqall({
//   dirname     :  __dirname + '/services',
//   filter      :  /(.+Service)\.js$/,
//   excludeDirs :  /^\.(git|svn)$/
// });
// }
//
// loadAll();

var RabbitClient;
console.log("Starting Up Message Bus");
amqp.connect(settings.rabbitmq, connected1);

var space = "92f697df-843b-49de-a1b7-0155493f2c25"//UUID of the space we are talking too.

function connected1(err, conn) {
    console.log("amqp callback.")
    if(conn!= null){
      console.log("Connection Established");
    }
        RabbitClient = conn;

        RabbitClient.createChannel(function (err, ch) {
            console.log("channel created");
           RabbitChannel = ch;

// RabbitChannel.publish(space, '', new Buffer('{"presence":"leave"}'));

//stage height and width needed by leapmotion to determine the position of the use the cursor on screen
      var stageWidth = 800;
      var stageHeight = 800;

      var hover = false;
      var drop = false;

      leap.loop({
        enableGestures: true,
        frame: function(frame){
          var handsInFrame = frame.hands;
          if(handsInFrame.length > 0 ){
            var hand = handsInFrame[0];
            if(hand.grabStrength == 1){
              // console.log(RabbitClient);
              console.log(frame);
              if(hover){
                RabbitChannel.publish(space,'',new Buffer('{"hover":"put coordinates here"}'));
              }else{
                RabbitChannel.publish(space,'',new Buffer('{"drag":"put source here"}'));
                hover = true;
              }
            }else{
              if(hand.grabStrength == 0){
                if(hover){
                  RabbitChannel.publish(space,'',new Buffer('{"drop":"put target here"}'));
                }
              }
            }


          }
        }
      });
  });
}
