/*jslint node: true, indent: 2, sloppy: true, white: true, vars: true */

var fs = require('fs');
var csv = require('csv');
var express = require('express');
var Schema = require('protobuf').Schema;

// XXX var TRIPMAP_FILE = 'trip_id_converter.json';
// XXX var STOPMAP_FILE = 'stop_id_converter.json';

var app = express.createServer(express.logger());

express.bodyParser.parse['text/plain'] = function (req, options, callback) {
  var buf = '';
  req.setEncoding('utf8');
  req.on('data', function(chunk){
    buf += chunk;
  });
  req.on('end', function(){
    try {
      if (!buf.length) {
        req.body = '';
      } else {
        req.body = buf;
      }
      callback();
    } catch (err) {
      callback(err);
    }
  });
};

app.configure(function () {
  app.use(function (req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    next();
  });
  app.use(express.bodyParser());
});


var schema = new Schema(fs.readFileSync('gtfs-realtime.desc'));
var FeedMessage = schema['transit_realtime.FeedMessage'];

var tripMap = null;
var stopMap = null;

var serializedFeed = null;

var getEntityId = (function () {
  var id = 0;
  return function() {
    id += 1;
    return id;
  };
}());

function getSequence() {
  var sequence = 1;
  // TODO: The sequence should be based on a transit-day in Detroit time, not a
  // clock-day in UTC or server time.
  var today = (new Date()).getDay();
  if (today >= 1 && today <= 5) {
    sequence = 1;
  } else if (today === 6) {
    sequence = 2;
  } else if (today === 0) {
    sequence = 3;
  }

  console.log('Using sequence id: ' + sequence); // XXX
  return sequence;
}

function createProtobuf(adherence) {
  var feedMessage = {
    header: {
      gtfsRealtimeVersion: 1,
      incrementality: 2,
      timestamp: Date.now()
    },
    entity: []
  };

  var sequence = getSequence();

  csv()
  .from(adherence, {columns: false})
  .on('data', function (data) {
    var avlTripId = data[1];
    var delay = parseInt(data[2], 10);
    var avlStopId = data[3];

    var feedEntity = {
      id: getEntityId(),
      tripUpdate: {
        trip: {
          //tripId: tripMap[avlTripId][sequence]
          tripId: tripMap[avlTripId][sequence][0] // XXX
        },
        stopTimeUpdate: [{
          stopId: stopMap[avlStopId],
          arrival: {
            // XXX delay: delay
            delay: 0 // XXX
            //delay: 3600 // XXX
          }
        }]
      }
    };

    feedMessage.entity.push(feedEntity);
  })
  .on('error', function (error) {
    console.log(error);
  })
  .on('end', function (count) {
    // serialize the message
    serializedFeed = FeedMessage.serialize(feedMessage);
    // XXX
    //console.log(JSON.stringify(feedMessage));
    //fs.writeFileSync(JSON_OUT, JSON.stringify(feedMessage, null, '  '));
    //fs.writeFileSync(PROTOBUF_OUT, serializedFeed);
    console.log('Created GTFS-Realtime data from ' + count + ' rows of AVL data.');
  });
}

app.get('/gtfs-realtime/trip-updates', function (req, response) {
  response.send(serializedFeed);
});

app.post('/adherence', function (req, response) {
  console.log('Processing adherence data');
  createProtobuf(req.body);
  response.send();
});

app.post('/fake-realtime', function (req, response) {
  serializedFeed = FeedMessage.serialize(req.body);
  // XXX
  //fs.writeFileSync(JSON_OUT, JSON.stringify(req.body, null, '  '));
  //fs.writeFileSync(PROTOBUF_OUT, serializedFeed);
  console.log('Using fake GTFS-Realtime data');
  response.send();
});

app.post('/post-test', function (req, response) {
  console.log('Got a post with req.body.length = ' + req.body.length);
  csv()
  .from(req.body, {columns: false})
  .on('data', function (data) {
  })
  .on('error', function (error) {
    console.log(error);
  })
  .on('end', function (count) {
    console.log('Got a CSV to post-test with ' + count + ' rows.');
  });
  response.send();
});

function startServer() {
  var port = process.env.PORT || 3000;
  app.listen(port, function () {
    console.log('Listening on ' + port);
  });
}

// fs.readFile(TRIPMAP_FILE, function (error, data) {
//   tripMap = JSON.parse(data);
//   fs.readFile(STOPMAP_FILE, function (error, data) {
//     stopMap = JSON.parse(data);
//     //createProtobuf();
//     startServer();
//   });
// });
startServer();
