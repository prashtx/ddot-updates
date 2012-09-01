/*jslint node: true, indent: 2, sloppy: true, white: true, vars: true */

/* Process the GTFS data so that we can quickly create lookup tables from the
 * AVL DB's static data.
 * We only need to run this once for each GTFS package.
 */
var csv = require('csv');
var zip = require('zip');
var Q = require('q');
var util = require('util');
var tz = require('timezone/loaded');

var stopsCSV;
var stopTimesCSV;
var tripsCSV;
var calendarCSV;
var calendarDatesCSV;


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
  .on('end', function (count) {
    cb(stop_id_name);
  })
  .on('error', function (error) {
    throw error;
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
  .on('end', function (count) {
    cb(trips);
  })
  .on('error', function (error) {
    throw error;
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
  })
  .on('error', function (error) {
    throw error;
  });
}

function processBlockIds(trips, cb) {
  console.log('Processing block IDs.');
  csv()
  .from(tripsCSV, {columns: true})
  .on('data', function (data, index) {
    trips[data.trip_id].block_id = data.block_id;
  })
  .on('end', function (count) {
    cb(trips);
  })
  .on('error', function (error) {
    throw error;
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

// TODO: handle exceptions
function handleTrips() {
  var def = Q.defer();
  processStops(function (stops) {
    processStopTimes(stops, function (trips) {
      processServiceIds(trips, function (trips) {
        processTrips(trips, function (startNodeMap) {
          def.resolve(startNodeMap);
        });
      });
    });
  });
  return def.promise;
}

function handleStops() {
  var stopNameMap = {};
  var def = Q.defer();

  console.log('Processing stops.');

  csv()
  .from(stopsCSV, {columns: true})
  .on('data', function (data, index) {
    stopNameMap[data.stop_name.trim().toLocaleLowerCase()] = data.stop_id;
  })
  .on('end', function (count) {
    def.resolve(stopNameMap);
  })
  .on('error', function (error) {
    def.reject(error);
  });

  return def.promise;
}

// Returns a promise for an object that maps day of week (Sunday = '0') to
// service ID
// This processes very simple calendar.txt files.
function processCalendar() {
  console.log('Processing calendar.');
  var def = Q.defer();
  var days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  var baseCalendar = {};

  csv()
  .from(calendarCSV, {columns: true})
  .on('data', function (data, index) {
    var i;
    for (i = 0; i < days.length; i += 1) {
      if (data[days[i]] === '1') {
        baseCalendar[i] = parseInt(data.service_id, 10);
      }
    }
  })
  .on('end', function (count) {
    def.resolve(baseCalendar);
  })
  .on('error', function (error) {
    def.reject(error);
  });

  return def.promise;
}

// Returns a promise for a function that maps a date (as POSIX time) to service
// ID
function processExceptions(dayToSequence) {
  console.log('Processing calendar exceptions.');
  var def = Q.defer();
  var exceptions = {};

  csv()
  .from(calendarDatesCSV, {columns: true})
  .on('data', function (data, index) {
    if (data.exception_type === '1') {
      exceptions[data.date] = parseInt(data.service_id, 10);
    }
  })
  .on('end', function (count) {
    var dateToServiceID = function (time) {
      // TODO: handle transit time, in which 12.30 AM is considered part of
      // the previous calendar day.
      // Put date into YYYMMDD format
      var date = tz(time, '%Y%m%d', 'America/Detroit');
      var serviceID = exceptions[date];
      if (serviceID !== undefined) {
        return serviceID;
      }
      // Get the day of the week. Sunday = '0'.
      var day = tz(time, '%w', 'America/Detroit');
      return dayToSequence[day];
    };
    def.resolve(dateToServiceID);
  })
  .on('error', function (error) {
    def.reject(error);
  });

  return def.promise;
}

function handleCalendar() {
  return processCalendar()
  .then(function (dayToSequence) {
    return processExceptions(dayToSequence);
  });
}

function readGtfsPackage(zipData) {
  var data = zip.Reader(zipData).toObject('utf-8');

  stopsCSV = data['stops.txt'];
  stopTimesCSV = data['stop_times.txt'];
  tripsCSV = data['trips.txt'];
  calendarCSV = data['calendar.txt'];
  calendarDatesCSV = data['calendar_dates.txt'];

  // Return the end date, so we know when to check for new GTFS data
  return new Date(2012, 7, 31); // XXX
}


module.exports = (function () {
  var self = {};

  self.makeGtfsTables = function (zipData, cb) {
    // Read in the relevant GTFS data
    var endDate = readGtfsPackage(zipData);

    Q.all([
      handleTrips(),
      handleStops(),
      handleCalendar()
    ]).spread(function (startNodeMap, stopNameMap, calendar) {
      cb({
        startNodeMap: startNodeMap,
        stopNameMap: stopNameMap,
        calendar: calendar
      });
    });

    return endDate;
  };

  return self;
}());

