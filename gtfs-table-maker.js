/*jslint node: true, indent: 2, sloppy: true, white: true, vars: true */

/* Process the GTFS data so that we can quickly create lookup tables from the
 * AVL DB's static data.
 * We only need to run this once for each GTFS package.
 */
var csv = require('csv');
var zip = require('zip');

var stopsCSV;
var stopTimesCSV;
var tripsCSV;


function convertTimeToSec(time) {
  var hms = time.split(':');
  var sec = parseInt(hms[2], 10) +
            60 * parseInt(hms[1], 10) +
            3600 * parseInt(hms[0], 10);
  return sec.toString();
}

function processStops(cb) {
  var stop_id_name = {};

  csv()
  .from(stopsCSV, {columns: true})
  .on('data', function (data, index) {
    stop_id_name[data.stop_id] = data.stop_name;
  })
  .on('end', function (error) {
    cb(stop_id_name);
  });

}

function processStopTimes(stop_id_name, cb) {
  var trips = {};
  csv()
  .from(stopTimesCSV, {columns: true})
  .on('data', function (data, index) {
    var trip = trips[data.trip_id];
    var stopSeq = parseInt(data.stop_sequence, 10);
    if (trip === undefined) {
      trip = {};
      trips[data.trip_id] = trip;
    }
    if (stopSeq === 1) {
      trip.start = stop_id_name[data.stop_id];
    } else {
      if (trip.end === undefined) {
        trip.end = stop_id_name[data.stop_id];
        trip.end_seq = stopSeq;
        trip.end_time = data.arrival_time;
      } else {
        // See if this is the last stop so far.
        if (stopSeq > trip.end_seq) {
          trip.end = stop_id_name[data.stop_id];
          trip.end_seq = stopSeq;
          trip.end_time = data.arrival_time;
        }
      }
    }
  })
  .on('end', function (error) {
    cb(trips);
  });
}

function processServiceIds(trips, cb) {
  console.log('Processing service IDs.');
  csv()
  .from(tripsCSV, {columns: true})
  .on('data', function (data, index) {
    trips[data.trip_id].service_id = data.service_id;
  })
  .on('end', function (error) {
    cb(trips);
  });
}

function processBlockIds(trips, cb) {
  console.log('Processing block IDs.');
  csv()
  .from(tripsCSV, {columns: true})
  .on('data', function (data, index) {
    trips[data.trip_id].block_id = data.block_id;
  })
  .on('end', function (error) {
    cb(trips);
  });
}

function processTrips(trips, cb) {
  console.log('Processing trips.');
  var startNodeMap = {};
  var tripID;
  var tripCount = 0;
  var dupCount = 0;
  for (tripID in trips) {
    if (trips.hasOwnProperty(tripID)) {
      var trip = trips[tripID];
      var endNodeMap = startNodeMap[trip.start];
      if (endNodeMap === undefined) {
        endNodeMap = {};
        startNodeMap[trip.start] = endNodeMap;
      }
      var endTimeMap = endNodeMap[trip.end];
      if (endTimeMap === undefined) {
        endTimeMap = {};
        endNodeMap[trip.end] = endTimeMap;
      }
      var endTimeSec = convertTimeToSec(trip.end_time);
      var serviceIdMap = endTimeMap[endTimeSec];
      if (serviceIdMap === undefined) {
        serviceIdMap = {};
        endTimeMap[endTimeSec] = serviceIdMap;
      }
      var tripList = serviceIdMap[trip.service_id];
      if (tripList === undefined) {
        serviceIdMap[trip.service_id] = [tripID];
      } else {
        tripList.push(tripID);

        dupCount += 1;
      }
      /*
      var blockIdMap = endTimeMap[endTimeSec];
      if (blockIdMap === undefined) {
        blockIdMap = {};
        endTimeMap[endTimeSec] = blockIdMap;
      }
      if (blockIdMap[trip.block_id] !== undefined) {
        console.log('WOOPS!!! This tuple does not uniquely identify a route!' +
                    ' start node: ' + trip.start +
                    ' end node: ' + trip.end +
                    ' end time: ' + trip.end_time +
                    ' block id: ' + trip.block_id);
      }
      blockIdMap[trip.block_id] = tripID;
      */

      tripCount += 1;
    }
  }

  console.log('Trip count: ' + tripCount);
  console.log('Duplicate trip count: ' + dupCount);

  cb(startNodeMap);
}

function handleTrips(cb) {
  processStops(function (stops) {
    processStopTimes(stops, function (trips) {
      processServiceIds(trips, function (trips) {
        processTrips(trips, function (startNodeMap) {
          cb(startNodeMap);
        });
      });
    });
  });
}

function handleStops(cb) {
  var stopNameMap = {};

  console.log('Processing stops.');

  csv()
  .from(stopsCSV, {columns: true})
  .on('data', function (data, index) {
    stopNameMap[data.stop_name.trim().toLocaleLowerCase()] = data.stop_id;
  })
  .on('end', function (error) {
    cb(stopNameMap);
  });
}

function readGtfsPackage(zipData) {
  var data = zip.Reader(zipData).toObject('utf-8');

  stopsCSV = data['stops.txt'];
  stopTimesCSV = data['stop_times.txt'];
  tripsCSV = data['trips.txt'];

  // Return the end date, so we know when to check for new GTFS data
  return new Date(2012, 7, 31); // XXX
}


module.exports = (function () {
  var self = {};

  self.makeGtfsTables = function (zipData, cb) {
    // Read in the relevant GTFS data
    var endDate = readGtfsPackage(zipData);

    handleTrips(function(startNodeMap) {
      handleStops(function(stopNameMap) {
        var gtfsTables = {
          startNodeMap: startNodeMap,
          stopNameMap: stopNameMap
        };
        cb(gtfsTables);
      });
    });

    return endDate;
  };

  return self;
}());

