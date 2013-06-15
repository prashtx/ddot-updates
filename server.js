/*jslint node: true, indent: 2, sloppy: true, white: true, vars: true */

var fs = require('fs');
var csv = require('csv');
var express = require('express');
var Schema = require('protobuf').Schema;
var StaticData = require('./static-data.js').StaticData;
var gtfsProcessor = require('./gtfs-table-maker.js');
var request = require('request');
var tz = require('timezone/loaded');
var util = require('util');
var http = require('http');

// Determines if we enable an HTML site for testing the data.
var useTestSite = process.env.TEST_SITE;

var staticData = new StaticData();

var app = express();
var server = http.createServer(app);


var MAX_AVL_AGE = 24*60*60*1000;

app.use(express.logger());
//express.bodyParser.parse['text/plain'] = function (req, options, callback) {
function textParser(req, res, next) {
  if (req._body) { return next(); }
  req.body = req.body || {};

  // For GET/HEAD, there's no body to parse.
  if ('GET' === req.method || 'HEAD' === req.method) { return next(); }

  // Check for text/plain content type
  var type = req.headers['content-type'];
  if (type === undefined || 'text/plain' !== type.split(';')[0]) { return next(); }

  // Flag as parsed
  req._body = true;

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
      next();
    } catch (err) {
      err.status = 400;
      next(err);
    }
  });
}

app.use(textParser);

app.configure(function () {
  app.use(function (req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    next();
  });
  app.use(express.bodyParser());
});


var schema = new Schema(fs.readFileSync('gtfs-realtime.desc'));
var FeedMessage = schema['transit_realtime.FeedMessage'];

var serializedFeed = FeedMessage.serialize({
  header: {
    gtfsRealtimeVersion: 1,
    incrementality: 2,
    timestamp: Date.now()
  },
  entity: []
});
var tripDelays = {};

var getEntityId = (function () {
  var id = 0;
  return function() {
    id += 1;
    return id;
  };
}());

// Fetch the GTFS package from the FTP site
// cb(err, data)
function getGtfsPackage(cb) {
  console.log('Getting GTFS package');
  request.get({
    url: process.env.GTFS_URL,
    encoding: null
  }, function (error, response, body) {
    if (error) {
      return cb(error);
    }
    cb(null, body);
  });
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

  var sequence = staticData.calendar(Date.now());

  var tripMissCount = 0;
  var workMissCount = 0;

  csv()
  .from(adherence, {columns: false, trim: true})
  .on('data', function (data) {
    // Convert minutes of adherence to seconds of delay
    var delay = -60 * parseInt(data[1], 10);
    var workId = data[2];
    var timestamp = data[3];

    // Make sure we got a adherence number
    if (isNaN(delay)) {
      return;
    }

    var potentialTrips = staticData.workTripMap[workId];
    if (potentialTrips === undefined) {
      console.log('Could not find trips corresponding to an AVL work piece ID: ' + workId);
      workMissCount += 1;

      return;
    }

    var posixTime = tz(timestamp);
    var messageTime = (3600 * parseInt(tz(posixTime, '%H', 'America/Detroit'), 10)) +
      (60 * parseInt(tz(posixTime, '%M', 'America/Detroit'), 10)) +
      parseInt(tz(posixTime, '%S', 'America/Detroit'), 10);

    // Look for the current trip. It's the one that ends the soonest, _after_
    // the message timestamp.
    var avlTrip = potentialTrips.reduce(function (memo, trip) {
      // If the trip has already ended, rule it out.
      if (trip.endTime < messageTime) {
        return memo;
      }
      // If this is the only valid trip we've found, then it becomes our
      // candidate.
      if (memo === null) {
        return trip;
      }
      // If the trip is valid and ends earlier than the ones we've seen so far,
      // then it becomes our candidate.
      if (trip.endTime < memo.endTime) {
        return trip;
      }
      return memo;
    }, null);

    if (avlTrip === null) {
      console.log(util.format('Could not find a trip for work piece: %s and timestamp: %s', workId, timestamp));
      workMissCount += 1;

      return;
    }

    var avlTripId = avlTrip.id;

    if (staticData.tripMap[avlTripId] === undefined) {
      console.log('Could not find AVL Trip ID: ' + avlTripId);
      tripMissCount += 1;
    }

    // TODO: Why is the trip ID being added as an Array?
    //tripDelays[staticData.tripMap[avlTripId][sequence]] = delay;
    tripDelays[staticData.tripMap[avlTripId][sequence][0]] = delay;
  })
  .on('error', function (error) {
    console.log(error);
  })
  .on('end', function (count) {
    // Turn the set of delays into trip updates
    var trip;
    for (trip in tripDelays) {
      if (tripDelays.hasOwnProperty(trip)) {
        feedMessage.entity.push({
          id: getEntityId(),
          tripUpdate: {
            trip: {
              // TODO: Why is the trip ID being added as an Array?
              //tripId: tripMap[avlTripId][sequence]
              tripId: trip
            },
            stopTimeUpdate: [{
              //stopId: staticData.stopMap[avlStopId],
              stopSequence: 1,
              arrival: {
                delay: tripDelays[trip]
              }
            }]
          }
        });
      }
    }
    // serialize the message
    serializedFeed = FeedMessage.serialize(feedMessage);
    console.log('Created GTFS-Realtime data from ' + count + ' rows of AVL data.');
    console.log('Could not resolve ' + tripMissCount + ' AVL trip IDs.');
    console.log('Could not resolve ' + workMissCount + ' AVL work piece IDs.');
  });
}

app.get('/gtfs-realtime/trip-updates', function (req, response) {
  response.send(serializedFeed);
});

app.get('/gtfs-realtime/trip-updates.json', function (req, response) {
  if (serializedFeed) {
    response.send(FeedMessage.parse(new Buffer(serializedFeed)));
  } else {
    response.send();
  }
});

app.post('/adherence', function (req, response) {
  if (staticData.tripMap && staticData.workTripMap &&
      staticData.getAvlAge() < MAX_AVL_AGE) {
    console.log('Processing adherence data');
    createProtobuf(req.body);
    response.send(JSON.stringify({needsStaticData: false}));
  } else {
    // XXX
    if (staticData.getAvlAge() >= MAX_AVL_AGE) {
      console.log('Static AVL data is too old.');
    }
    if (!staticData.tripMap) {
      console.log('We have no trip map.');
    }
    if (!staticData.workTripMap) {
      console.log('We have no map from work piece to AVL trips.');
    }
    // XXX
    // Indicate that we need the static AVL data payload
    response.send(JSON.stringify({needsStaticData: true}));
  }
});

app.post('/static-avl/blocks', function (req, response) {
  staticData.setAvlBlocks(req.body);
  response.send();
});

app.post('/static-avl/trips', function (req, response) {
  staticData.setAvlTrips(req.body);
  response.send();
});

app.post('/static-avl/stops', function (req, response) {
  staticData.setAvlStops(req.body);
  response.send();
});

app.post('/fake-realtime', function (req, response) {
  serializedFeed = FeedMessage.serialize(req.body);
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

// For testing
// Respond with JSON describing the AVL work piece ID -> trip ID mapping.
app.get('/static-avl/work-trip-map', function (req, response) {
  response.send(staticData.workTripMap);
});

// Respond with the sequence ID/service ID
app.get('/test/sequence', function (req, response) {
  var time = parseInt(req.query.time, 10);
  if (time === undefined || isNaN(time)) {
    time = Date.now();
  }
  response.send({sequence: staticData.calendar(time)});
});

if (useTestSite) {
  // Enable the test site
  console.log('Enabled HTML test site');
  app.use(express['static']('./public'));
}

function startServer() {
  // TODO: Check the GTFS location regularly for updates. Rebuild the tables
  // when we find new GTFS data.
  getGtfsPackage(function (error, zipData) {
    // TODO: if we get an error, we should retry intelligently
    if (error) {
      throw error;
    }
    // TODO: use the return value from makeGtfsTables to figure out when to
    // check for new data.
    gtfsProcessor.makeGtfsTables(zipData, function (tables) {
      staticData.setGtfsTables(tables);
    });
  });

  var port = process.env.PORT || 3000;
  server.listen(port, function () {
    console.log('Listening on ' + port);
  });
}

startServer();
