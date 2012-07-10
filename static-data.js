/*jslint node: true, indent: 2, sloppy: true, white: true, vars: true */

var converter = require('./avl-gtfs-converter.js');
var csv = require('csv');

// cb(tripMap, error)
function createTripMap(builder, avlTrips, cb) {
  var tripMap = null;
  var goodCount = 0;
  var count = 0;
  csv()
  .from(avlTrips, {columns: false, trim: true})
  .on('data', function (data, index) {
    count += 1;
    var startNode = data[3].trim();
    var endNode = data[2].trim();
    var endTime = data[1].trim();
    var avlTripId = data[0];

    tripMap = builder(avlTripId, startNode, endNode, endTime);

    if (tripMap[avlTripId] !== undefined) {
      goodCount += 1;
    }
  })
  .on('end', function (count) {
    console.log('Successfully mapped ' + goodCount + ' trips out of ' + count);
    cb(tripMap);
  })
  .on('error', function (error) {
    cb(null, error);
  });
}

// cb(tripMap, error)
function createStopMap(builder, avlStop, cb) {
  var stopMap = null;
  var count = 0;
  var badCount = 0;
  csv()
  .from(avlStop, {columns: false, trim: true})
  .on('data', function (data, index) {
    var avlId = data[0];
    var stopName = data[1].trim().toLocaleLowerCase();

    stopMap = builder(stopName, avlId);

    if (stopMap[avlId] === undefined) {
      console.log('Error: did not find ' + stopName + ' in GTFS. AVL ID: ' + avlId);
      badCount += 1;
    }

    count += 1;
  })
  .on('end', function (count) {
    console.log('');
    console.log('Processed ' + count + ' stops from AVL.');
    console.log('Found ' + badCount + ' that did not match GTFS stop names.');

    cb(stopMap);
  })
  .on('error', function (error) {
    cb(null, error);
  });
}


function StaticData() {
  this.tripMap = null;
  this.stopMap = null;

  this.avlTripsTimestamp = null;
  this.avlStopsTimestamp = null;
  this.avlTimestamp = null;
}

//StaticData.prototype = new EventEmitter();
StaticData.prototype = {};

// create tripMap and stopMap
StaticData.prototype.createIdMaps = function(cb) {
  var self = this;

  var tripMapBuilder = converter.getTripMapBuilder(self.startNodeMap);
  createTripMap(tripMapBuilder, self.avlTrips, function (map, error) {
    // Reset the AVL static trip data
    self.avlTrips = null;

    if (error) {
      console.log(error.message);
    } else {
      self.tripMap = map;
    }
  });

  var stopMapBuilder = converter.getStopMapBuilder(self.stopNameMap);
  createStopMap(stopMapBuilder, self.avlStops, function (map, error) {
    // Reset the AVL static stop data
    self.avlStops = null;

    if (error) {
      console.log(error.message);
    } else {
      self.stopMap = map;
    }
  });
};

StaticData.prototype.setGtfsTables = function (tables) {
  this.startNodeMap = tables.startNodeMap;
  this.stopNameMap = tables.stopNameMap;

  if (this.avlTrips && this.avlStops) {
    this.createIdMaps();
  }
};

StaticData.prototype.setAvlTrips = function (avlTrips) {
  this.avlTrips = avlTrips;
  if (this.avlStops && this.startNodeMap && this.stopNameMap) {
    this.createIdMaps();
  }

  // Update the timestamp
  this.setAvlTripsTimestamp(Date.now());
};

StaticData.prototype.setAvlStops = function (avlStops) {
  this.avlStops = avlStops;
  console.log('Got AVL static stop info.');
  if (this.avlTrips && this.startNodeMap && this.stopNameMap) {
    this.createIdMaps();
  } else {
    if (!this.avlTrips) {
      console.log('Need static trip info.');
    } else if (!this.startNodeMap) {
      console.log('Need the GTFS start node map.');
    } else if (!this.stopNameMap) {
      console.log('Need the GTFS stop name map.');
    }
  }

  // Update the timestamp
  this.setAvlStopsTimestamp(Date.now());
};

StaticData.prototype.setAvlTripsTimestamp = function (ts) {
  if (this.avlStopsTimestamp) {
    this.avlTimestamp = ts;
    this.avlStopsTimestamp = null;
    this.avlTripsTimestamp = null;
  }
};

StaticData.prototype.setAvlStopsTimestamp = function (ts) {
  if (this.avlTripsTimestamp) {
    this.avlTimestamp = ts;
    this.avlStopsTimestamp = null;
    this.avlTripsTimestamp = null;
  }
};

StaticData.prototype.getAvlAge = function () {
  return Date.now() - this.avlTimestamp;
};

module.exports = (function () {
  return {
    StaticData: StaticData
  };
}());
